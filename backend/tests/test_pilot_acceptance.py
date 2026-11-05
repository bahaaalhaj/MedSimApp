"""The opt-in live runner must first work with no provider/network access."""
import json
import os
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest


class PilotAcceptanceTests(unittest.TestCase):
    def test_scripted_four_turn_plan_is_owner_bound_and_serializes_overlap(self):
        backend = Path(__file__).resolve().parents[1]
        with tempfile.TemporaryDirectory() as directory:
            output = Path(directory) / 'report.json'
            result = subprocess.run([sys.executable, str(backend / 'pilot_acceptance.py'), '--output', str(output)],
                env={**os.environ, 'OPENROUTER_API_KEY': '', 'OPENROUTER_MODEL': 'nvidia/nemotron-3.5-super-vl:free',
                     'MEDSIM_LLM_PROVIDER': 'openrouter'}, capture_output=True, timeout=30)
            self.assertEqual(result.returncode, 0, result.stderr.decode(errors='replace')[-2000:])
            report = json.loads(output.read_text())
            self.assertFalse(report['live'])
            self.assertEqual(report['completionRequestsDispatched'], 4)
            self.assertEqual((report['patientTimeoutSeconds'], report['semanticTimeoutSeconds']), (7.8, 8.0))
            self.assertTrue(report['poolClosedOnShutdown'])
            self.assertTrue(all(row['successfulTerminalSSE'] and row['ownerIsolation'] and row['acknowledged']
                                for row in report['rows']))
            overlap = [row for row in report['rows'] if row['label'].startswith('overlap')]
            self.assertEqual(len(overlap), 2)
            self.assertGreater(max(row['timings']['queueWaitMs'] for row in overlap), 20)
            self.assertTrue(all(row['timings']['completionRequestsDispatched'] == 1 for row in report['rows']))
            # Reusing an output path cannot spend a second budget.
            repeated = subprocess.run([sys.executable, str(backend / 'pilot_acceptance.py'), '--output', str(output)],
                capture_output=True, timeout=30)
            self.assertEqual(repeated.returncode, 1)
