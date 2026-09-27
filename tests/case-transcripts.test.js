import test from 'node:test';
import assert from 'node:assert/strict';
import { transcriptCursor, readTranscriptCursor, renderTranscript } from '../modules/tickets/transcript.js';

test('transcript positions preserve bigint precision and bind to the selected case ledger', () => {
  const caseToken = 'a'.repeat(48), channel = '123', position = ['9007199254740993', '9223372036854775807', '18446744073709551615'];
  const cursor = transcriptCursor(caseToken, channel, position);
  assert.deepEqual(readTranscriptCursor(cursor, caseToken, channel), position);
  assert.throws(() => readTranscriptCursor(cursor, caseToken, '124'), /TRANSCRIPT_INPUT_INVALID/);
  assert.throws(() => readTranscriptCursor(cursor, 'b'.repeat(48), channel), /TRANSCRIPT_INPUT_INVALID/);
  for (const value of ['!', transcriptCursor(caseToken, channel, ['9223372036854775808', '1', '2']), transcriptCursor(caseToken, channel, [1, '2', '3'])])
    assert.throws(() => readTranscriptCursor(value, caseToken, channel), /TRANSCRIPT_INPUT_INVALID/);
});

test('transcript rendering escapes nested retained text and emits no media, file path or actionable components', () => {
  const html = renderTranscript({ captureAvailable: false, gaps: [{ reasons: ['before-capture', '<gap>'] }], observations: [{
    message_id: '123', continuity_epoch: '1', sequence: '2', observed_at_ms: '3', kind: 'update', issues: ['<issue>'], attachments: [{ ordinal: 0, status: 'retained', bytes: 12 }],
    patch: { content: '</pre><script>alert(1)</script>', embeds: [{ description: '<img src=x>', url: 'https://cdn.example/private?signature=secret' }],
      components: [{ label: '<button>', custom_id: '<action>', url: 'https://private.example' }],
      attachments: [{ id: '456', filename: '<image>.png', size: 12, url: 'signed-secret', proxy_url: 'proxy-secret', retained_slot: 'vault-secret' }] },
  }] });
  assert.ok(html.includes('&lt;/pre&gt;&lt;script&gt;')); assert.ok(html.includes('&lt;image&gt;.png'));
  for (const forbidden of ['<script>', '<img ', '<button>', 'signed-secret', 'proxy-secret', 'vault-secret', 'https://']) assert.equal(html.includes(forbidden), false);
  assert.ok(html.includes('quarantined')); assert.ok(html.includes('unscanned')); assert.ok(html.includes('before-capture'));
});
