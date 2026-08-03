const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const RESULTS = path.join(__dirname, 'results');
const sources = {
  integration: path.join(RESULTS, 'e2e-report.json'),
  audioStabilization: path.join(RESULTS, 'audio-stabilization-report.json'),
  serviceWorker: path.join(RESULTS, 'service-worker-report.json')
};

function read(filePath) {
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

function hash(filePath) {
  return crypto.createHash('sha256').update(fs.readFileSync(filePath)).digest('hex');
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

const integration = read(sources.integration);
const audio = read(sources.audioStabilization);
const serviceWorker = read(sources.serviceWorker);
const passed = integration.checks.filter(check => check.status === 'passed');
const failed = integration.checks.filter(check => check.status === 'failed');

assert(passed.length === 29, `Ожидалось 29 пройденных интеграционных проверок, найдено ${passed.length}`);
assert(failed.length === 1 && /Service worker/.test(failed[0].name), 'Единственным прерванным сценарием должен быть service worker');
assert(audio.signature === 'ftyp', 'Целевой аудио/стабилизационный экспорт не является MP4');
assert(audio.output?.video === 'h264' && audio.output?.audio === 'aac', 'Целевой экспорт не имеет H.264/AAC');
assert(audio.durationDelta < 0.9, 'Целевой экспорт имеет недопустимое расхождение длительности');
assert(audio.consoleErrors?.length === 0, 'В целевой аудио/стабилизационной проверке есть ошибки консоли');
assert(serviceWorker.status === 'passed' && serviceWorker.errors?.length === 0, 'Повторная проверка service worker не пройдена');

const report = {
  schemaVersion: 1,
  status: 'passed',
  completedAt: new Date().toISOString(),
  uniqueBrowserChecks: 30,
  integrationRun: {
    startedAt: integration.startedAt,
    finishedAt: integration.finishedAt,
    passedBeforeResume: passed.length,
    resumedCheck: failed[0].name,
    consoleErrors: integration.console.filter(entry => entry.type === 'error' || entry.type === 'pageerror').length
  },
  resumedVerification: {
    serviceWorker: serviceWorker.status,
    active: serviceWorker.state?.active === true,
    controlled: serviceWorker.state?.controlled === true,
    errors: serviceWorker.errors?.length || 0
  },
  targetedRegression: {
    scenario: 'Озвучка + стабилизация + встроенные субтитры + MP4',
    signature: audio.signature,
    videoCodec: audio.output.video,
    audioCodec: audio.output.audio,
    sourceDuration: audio.source.duration,
    outputDuration: audio.output.duration,
    durationDelta: audio.durationDelta,
    consoleErrors: audio.consoleErrors.length
  },
  sourceReports: Object.fromEntries(Object.entries(sources).map(([name, filePath]) => [name, {
    path: path.relative(path.resolve(__dirname, '..'), filePath),
    sha256: hash(filePath)
  }]))
};

const target = path.join(RESULTS, 'final-verification.json');
fs.writeFileSync(target, JSON.stringify(report, null, 2));
process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
