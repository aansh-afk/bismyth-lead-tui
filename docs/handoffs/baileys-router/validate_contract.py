#!/usr/bin/env python3
"""Validate the proposed contract and synthetic examples, without network calls."""
import copy
import json
import re
from pathlib import Path

from jsonschema import Draft202012Validator, FormatChecker

ROOT = Path(__file__).resolve().parent
doc = json.loads((ROOT / 'openapi.json').read_text())
events = json.loads((ROOT / 'events.schema.json').read_text())
examples = json.loads((ROOT / 'examples.json').read_text())
checks = 0


def check(condition, label):
    global checks
    if not condition:
        raise AssertionError(label)
    checks += 1


def refs(value, root):
    if isinstance(value, dict):
        if '$ref' in value:
            pointer = value['$ref']
            check(pointer.startswith('#/'), 'Only local references are expected')
            target = root
            for key in pointer[2:].split('/'):
                target = target[key.replace('~1', '/').replace('~0', '~')]
        for child in value.values():
            refs(child, root)
    elif isinstance(value, list):
        for child in value:
            refs(child, root)


check(doc['openapi'] == '3.1.0', 'OpenAPI version')
check(doc['security'] == [{'apiKey': []}], 'API authentication required')
check(doc['components']['securitySchemes']['apiKey']['name'] == 'X-API-Key', 'Auth header')
refs(doc, doc)
refs(events, events)

operation_ids = set()
for path, methods in doc['paths'].items():
    for method, operation in methods.items():
        check(operation['operationId'] not in operation_ids, 'Unique operation ID')
        operation_ids.add(operation['operationId'])
        declared = {p['name'] for p in operation.get('parameters', []) if p['in'] == 'path' and p['required']}
        check(declared == set(re.findall(r'{([^}]+)}', path)), 'Path parameters match')
        check('401' in operation['responses'] and '403' in operation['responses'], 'Auth failures documented')


def validator(name):
    schema = {'$schema': 'https://json-schema.org/draft/2020-12/schema', 'components': doc['components']}
    schema.update(doc['components']['schemas'][name])
    return Draft202012Validator(schema, format_checker=FormatChecker())


for name in doc['components']['schemas']:
    Draft202012Validator.check_schema(validator(name).schema)
    checks += 1
Draft202012Validator.check_schema(events)
checks += 1

positive = [
    ('CreateSession', examples['requests']['createSession']),
    ('Send', examples['requests']['sendPreview']),
    ('Health', examples['responses']['health']),
    ('Session', examples['responses']['session']),
    ('Pairing', examples['responses']['pairing']),
    ('SendResult', examples['responses']['preview']),
    ('Operation', examples['responses']['operation']),
    ('Chats', examples['responses']['chats']),
    ('Messages', examples['responses']['messages']),
    ('NumberCheck', examples['responses']['numberCheck']),
    ('Error', examples['responses']['error']),
]
for name, value in positive:
    validator(name).validate(value)
    checks += 1

event_validator = Draft202012Validator(events, format_checker=FormatChecker())
for event in examples['events']:
    event_validator.validate(event)
    check(event['userId'] == event['data'].get('userId', event['userId']), 'Envelope session matches payload')

bad_phone = copy.deepcopy(examples['requests']['sendPreview'])
bad_phone['to'] = 'not-a-phone'
missing_preview = copy.deepcopy(examples['requests']['sendPreview'])
del missing_preview['dryRun']
fake_preview_send = copy.deepcopy(examples['responses']['preview'])
fake_preview_send['messageId'] = 'INVALID_FAKE_SEND_ID'
unknown_event = copy.deepcopy(examples['events'][0])
unknown_event['type'] = 'unrecognized'
bad_receipt = copy.deepcopy(examples['events'][2])
del bad_receipt['data']['messageId']
extra_send_field = copy.deepcopy(examples['requests']['sendPreview'])
extra_send_field['arbitraryField'] = True
negative = [
    (validator('Send'), bad_phone),
    (validator('Send'), missing_preview),
    (validator('SendResult'), fake_preview_send),
    (event_validator, unknown_event),
    (event_validator, bad_receipt),
    (validator('Send'), extra_send_field),
]
for schema_validator, value in negative:
    check(bool(list(schema_validator.iter_errors(value))), 'Invalid fixture must be rejected')

unresolved = copy.deepcopy(examples['responses']['messages'])
unresolved['messages'][0]['remoteJid'] = '123456789@lid'
unresolved['messages'][0]['chatId'] = '123456789@lid'
unresolved['messages'][0]['senderPhone'] = None
validator('Messages').validate(unresolved)
checks += 1

print(json.dumps({'passed': True, 'checks': checks, 'routes': len(doc['paths']), 'schemas': len(doc['components']['schemas']), 'positive_examples': len(positive), 'typed_events': len(examples['events']), 'negative_examples': len(negative), 'network_calls': 0, 'live_service_tested': False}, indent=2))
