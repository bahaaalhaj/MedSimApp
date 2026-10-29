"""Read-only OOXML structure/checksum check using Python's standard library.

The expected structure comes from the canonical TypeScript export model on stdin.
No clinical values are included in failure messages. Rendering remains an
additional gate in the opt-in workbook exporter, not a dependency of CI.
"""
import json
import math
import posixpath
import sys
import xml.etree.ElementTree as ET
import zipfile

NS = {'s': 'http://schemas.openxmlformats.org/spreadsheetml/2006/main'}
REL_ID = '{http://schemas.openxmlformats.org/officeDocument/2006/relationships}id'


def column_name(index):
    name = ''
    while index:
        index, remainder = divmod(index - 1, 26)
        name = chr(65 + remainder) + name
    return name


def verify(path, expected):
    with zipfile.ZipFile(path) as archive:
        if len(archive.namelist()) != len(set(archive.namelist())) or archive.testzip():
            raise ValueError('Invalid or corrupt workbook ZIP entries')

        def xml(name):
            data = archive.read(name)
            if b'<!DOCTYPE' in data or b'<!ENTITY' in data:
                raise ValueError('Workbook XML must not contain entity declarations')
            return ET.fromstring(data)

        def relationships(source):
            directory, filename = posixpath.split(source)
            root = xml(posixpath.join(directory, '_rels', filename + '.rels'))
            result = {}
            for rel in root:
                if rel.get('TargetMode') == 'External':
                    raise ValueError('External workbook relationships are not expected')
                target = posixpath.normpath(posixpath.join(directory, rel.attrib['Target']))
                target = target.lstrip('/')
                if target.startswith('../') or target not in archive.namelist():
                    raise ValueError('Missing or invalid workbook relationship target')
                if rel.attrib['Id'] in result:
                    raise ValueError('Duplicate workbook relationship ID')
                result[rel.attrib['Id']] = target
            return result

        workbook = xml('xl/workbook.xml')
        sheets = workbook.findall('s:sheets/s:sheet', NS)
        if [sheet.get('name') for sheet in sheets] != expected['sheetNames']:
            raise ValueError('Workbook sheet names/order differ from the export contract')
        targets = relationships('xl/workbook.xml')
        shared_strings = []
        if 'xl/sharedStrings.xml' in archive.namelist():
            shared_strings = [''.join(si.itertext()) for si in xml('xl/sharedStrings.xml')]

        def cell_value(cell):
            if cell.find('s:f', NS) is not None or cell.get('t') == 'e':
                raise ValueError('Unexpected formula or spreadsheet error cell')
            value = cell.find('s:v', NS)
            if cell.get('t') == 'inlineStr':
                return ''.join(node.text or '' for node in cell.findall('.//s:t', NS)) or None
            text = value.text if value is not None else None
            if text is None or text == '':
                return None
            kind = cell.get('t', 'n')
            if kind == 's':
                return shared_strings[int(text)] or None
            if kind == 'str':
                return text
            if kind == 'b' and text in {'0', '1'}:
                return text == '1'
            if kind == 'n':
                number = float(text)
                if math.isfinite(number):
                    return number
            raise ValueError('Unsupported workbook cell type/value')

        for sheet, contract in zip(sheets, expected['sheets'], strict=True):
            name = sheet.attrib['name']
            if name != contract['name']:
                raise ValueError('Sheet model order does not match the export contract')
            source = targets[sheet.attrib[REL_ID]]
            root = xml(source)
            actual = {}
            for cell in root.findall('s:sheetData/s:row/s:c', NS):
                address = cell.attrib['r']
                if address in actual:
                    raise ValueError(f'{name}: duplicate cell {address}')
                actual[address] = cell_value(cell)
            for table in contract['tables']:
                headers = [actual.get(f'{column_name(column)}{table["row"]}')
                           for column in range(1, len(table['headers']) + 1)]
                if headers != table['headers']:
                    raise ValueError(f'{name}: worksheet headers mismatch')
                for row_index in range(table['row'] + 1, table['row'] + table['rows'] + 1):
                    if not any(actual.get(f'{column_name(column)}{row_index}') is not None
                               for column in range(1, len(headers) + 1)):
                        raise ValueError(f'{name}: missing populated row {row_index}')
            if name == 'Export_Summary':
                if actual.get('Z5') != expected['semanticChecksum']:
                    raise ValueError('Export_Summary semantic checksum mismatch')
            else:
                last_row = contract['tables'][0]['rows'] + 1
                last_column = len(contract['tables'][0]['headers'])
                allowed = {f'{column_name(column)}{row}' for row in range(1, last_row + 1)
                           for column in range(1, last_column + 1)}
                if any(value is not None and address not in allowed for address, value in actual.items()):
                    raise ValueError(f'{name}: unexpected populated rows or columns')
            # Resolve and parse every table part too, rather than trusting an
            # intact cached checksum or checking only the final populated row.
            parts = root.findall('s:tableParts/s:tablePart', NS)
            rels = relationships(source) if parts else {}
            table_contracts = contract['tables']
            if len(parts) != len(table_contracts):
                raise ValueError(f'{name}: unexpected table count')
            for part, table in zip(parts, table_contracts, strict=True):
                saved = xml(rels[part.attrib[REL_ID]])
                last = f'{column_name(len(table["headers"]))}{table["row"] + table["rows"]}'
                if saved.get('ref') != f'A{table["row"]}:{last}':
                    raise ValueError(f'{name}: table range mismatch')
                headers = [col.get('name') for col in saved.findall('s:tableColumns/s:tableColumn', NS)]
                if headers != table['headers']:
                    raise ValueError(f'{name}: table headers mismatch')


if __name__ == '__main__':
    try:
        verify(sys.argv[1], json.load(sys.stdin))
    except (ValueError, KeyError, IndexError, OSError, ET.ParseError, zipfile.BadZipFile) as error:
        print(f'Workbook consistency check failed: {error}', file=sys.stderr)
        raise SystemExit(1)
