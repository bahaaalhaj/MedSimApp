"""Opt-in, fixed-budget real-provider comparison. Never retries a trial.

Runs actual owner-bound ASGI routes and grounding, without a second TTS lifespan.
The separately running application/Kokoro is left untouched. Private reports must
remain outside the repository. Unit tests cannot establish live success.
"""
import argparse
import asyncio
import json
import math
import statistics
import time
from dataclasses import replace
from pathlib import Path
from unittest.mock import patch

import httpx

TOTALS=(3.2,5.0,8.0)
PROBE_INDICES=(0,3,8,10)


def percentile95(values):
    return sorted(values)[math.ceil(.95*len(values))-1] if values else None


def summarize(rows):
    summaries=[]
    for total in TOTALS:
        group=[r for r in rows if r['totalDeadlineSeconds']==total]
        latency=[r['latencyMs'] for r in group]
        successful=[r['latencyMs'] for r in group if r['success']]
        categories={}
        for row in group:
            category=row['category']
            categories[category]=categories.get(category,0)+1
        summaries.append({'totalDeadlineSeconds':total,'innerTimeoutSeconds':round(total-.2,1),
            'attempts':len(group),'successes':len(successful),
            'successRate':len(successful)/len(group) if group else None,'categories':categories,
            'medianMs':statistics.median(latency) if latency else None,'p95Ms':percentile95(latency),
            'successfulMedianMs':statistics.median(successful) if successful else None,
            'successfulP95Ms':percentile95(successful)})
    return summaries


async def run(output):
    from medsim_backend.config import load_env_local
    load_env_local()  # precedes the provider singleton
    from local_llm import settings, build_provider, SerializingLocalLLMProvider
    from local_ai import LOCAL_AI_CASES
    from semantic_dialogue_smoke import PROBES
    import server
    from medsim_backend.services import patient_dialogue_service as dialogue
    base=settings()
    if base.provider!='openrouter' or base.patient_model!='nvidia/nemotron-3.5-super-vl:free' or base.allow_paid_models:
        raise SystemExit('Benchmark requires the verified explicit free NVIDIA primary.')
    report={'live':True,'method':'real ASGI routes + real provider; no second TTS lifespan',
        'model':base.patient_model,'maxCompletionRequests':12,'automaticRetries':0,
        'pacingSeconds':4,'p95Method':'nearest rank; four samples per group, not a stable tail estimate',
        'selectionRule':'shortest total with 4/4 grounded expected-content successes; otherwise inconclusive',
        'rows':[]}
    async with httpx.AsyncClient(timeout=10) as remote:
        quota=await remote.get('https://openrouter.ai/api/v1/key',headers={'Authorization':'Bearer '+base.api_key})
        quota.raise_for_status()
        remaining=quota.json().get('data',{}).get('free_model_daily_requests',{}).get('remaining')
    report['quotaRemainingBefore']=remaining
    if remaining is not None and remaining<12:
        report.update(status='blocked-insufficient-quota',summary=summarize([]),selectedTotalSeconds=None)
        output.write_text(json.dumps(report,indent=2)+'\n',encoding='utf-8')
        print(json.dumps(report));return 2
    health=await build_provider(base).health()
    if health.state!='ready':
        report.update(status='blocked-provider-not-ready',category=health.last_error_category)
        output.write_text(json.dumps(report,indent=2)+'\n',encoding='utf-8')
        print(json.dumps(report));return 2
    stop=False
    # Different orders reduce, but cannot eliminate, time/cache/capacity bias.
    orders=((3.2,5,8),(5,8,3.2),(8,3.2,5),(8,5,3.2))
    async with httpx.AsyncClient(transport=httpx.ASGITransport(app=server.app),base_url='http://127.0.0.1:8787',headers={'Origin':'http://localhost:5173'}) as client:
        for probe_index,order in zip(PROBE_INDICES,orders):
            cid,question,expected=PROBES[probe_index]
            for total in order:
                configured=replace(base,hosted_semantic_timeout_seconds=total,patient_timeout_seconds=round(total-.2,1))
                configured.validate()
                provider=SerializingLocalLLMProvider(build_provider(configured))
                created=await client.post('/api/attempts',json={'caseId':cid,'caseVersion':LOCAL_AI_CASES[cid]['caseVersion'],'variantSeed':'deadline-comparison'})
                created.raise_for_status();aid=created.json()['attemptId']
                rid=f'deadline-trial-{time.time_ns()}'
                started=time.perf_counter()
                try:
                    with patch.object(dialogue,'llm_settings',return_value=configured),patch.object(dialogue,'get_local_llm_provider',return_value=provider):
                        response=await client.post('/agent/patient/stream',json={'attemptId':aid,'source':'typed','question':question,'requestId':rid})
                    response.raise_for_status()
                    elapsed=round((time.perf_counter()-started)*1000,2)
                    frames=[json.loads(line[6:]) for line in response.text.splitlines() if line.startswith('data: ')]
                    terminal=frames[-1]
                    attempt=server._INVESTIGATION_ATTEMPTS[aid]
                    audit=attempt['patientResponses'].get(rid,{})
                    text=''.join(f.get('text','') for f in frames)
                    success=bool(terminal.get('done')) and audit.get('validationResult')=='valid-semantic-answer' and all(term.lower() in text.lower() for term in expected)
                    category='success' if success else terminal.get('category') or 'semantic-mismatch'
                    row={'caseId':cid,'question':question,'totalDeadlineSeconds':total,
                        'innerTimeoutSeconds':configured.patient_timeout_seconds,'latencyMs':elapsed,
                        'success':success,'category':category,'text':text,'actualModel':terminal.get('actualModel'),
                        'sourceIds':audit.get('matchedFactIds',[]),'validationResult':audit.get('validationResult'),
                        'providerLatencyMs':audit.get('providerLatencyMs') or attempt.get('patientFailures',{}).get(rid,{}).get('providerLatencyMs'),
                        'transcriptEntriesAdded':len(attempt['transcript'])-1,'scoringQuestionIds':attempt['askedQuestionIds']}
                    report['rows'].append(row)
                    output.write_text(json.dumps(report,indent=2)+'\n',encoding='utf-8')
                    print(json.dumps({k:row[k] for k in ['caseId','totalDeadlineSeconds','innerTimeoutSeconds','success','category','latencyMs']}),flush=True)
                    if category in {'rate-limited','free-capacity-unavailable','configuration-invalid'}:
                        stop=True;break
                    await asyncio.sleep(max(0,4-(time.perf_counter()-started)))
                finally:
                    server._INVESTIGATION_ATTEMPTS.pop(aid,None)
            if stop:break
    report['summary']=summarize(report['rows'])
    eligible=[g['totalDeadlineSeconds'] for g in report['summary'] if g['attempts']==4 and g['successes']==4]
    report['selectedTotalSeconds']=min(eligible) if eligible and not stop else None
    report['status']='complete' if not stop else 'stopped-provider-limit'
    output.write_text(json.dumps(report,indent=2)+'\n',encoding='utf-8')
    print(json.dumps({k:report[k] for k in ['status','summary','selectedTotalSeconds']},indent=2))
    return 0 if report['selectedTotalSeconds'] is not None else 2


if __name__=='__main__':
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--live',action='store_true',required=True)
    parser.add_argument('--output',type=Path,required=True)
    args=parser.parse_args()
    if args.output.resolve().is_relative_to(Path(__file__).resolve().parents[1]):
        parser.error('output must be outside the repository')
    raise SystemExit(asyncio.run(run(args.output)))
