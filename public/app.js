const form = document.querySelector('#extract-form');
const fileInput = document.querySelector('#file-input');
const dropZone = document.querySelector('#drop-zone');
const fileList = document.querySelector('#file-list');
const extractButton = document.querySelector('#extract-button');
const inputPanel = document.querySelector('#input-panel');
const processingPanel = document.querySelector('#processing-panel');
const resultPanel = document.querySelector('#result-panel');
const progressText = document.querySelector('#progress-text');
const emailOutput = document.querySelector('#email-output');
const errorMessage = document.querySelector('#error-message');
const cancelButton = document.querySelector('#cancel-button');
const copyButton = document.querySelector('#copy-button');
const restartButton = document.querySelector('#restart-button');
const copyStatus = document.querySelector('#copy-status');
const resultSummary = document.querySelector('#result-summary');
const verificationPanel = document.querySelector('#verification-panel');
const verificationCount = document.querySelector('#verification-count');
const verificationList = document.querySelector('#verification-list');

let selectedFiles = [];
let controller = null;
let activeJobId = null;

function addFiles(files) {
  const existing = new Set(selectedFiles.map((file) => `${file.name}:${file.size}:${file.lastModified}`));
  for (const file of files) {
    const key = `${file.name}:${file.size}:${file.lastModified}`;
    if (!existing.has(key) && selectedFiles.length < 35) {
      selectedFiles.push(file);
      existing.add(key);
    }
  }
  renderFiles();
}

function renderFiles() {
  fileList.replaceChildren();
  selectedFiles.forEach((file, index) => {
    const row = document.createElement('li');
    row.className = 'file-row';
    const badge = document.createElement('span');
    badge.className = 'file-badge';
    badge.textContent = file.name.toLowerCase().endsWith('.pdf') ? 'PDF' : 'TXT';
    const name = document.createElement('span');
    name.className = 'file-name';
    name.textContent = file.name;
    const remove = document.createElement('button');
    remove.type = 'button';
    remove.className = 'remove-file';
    remove.setAttribute('aria-label', `Remove ${file.name}`);
    remove.textContent = 'Remove';
    remove.addEventListener('click', () => {
      selectedFiles.splice(index, 1);
      renderFiles();
    });
    row.append(badge, name, remove);
    fileList.append(row);
  });
  extractButton.disabled = selectedFiles.length === 0;
}

dropZone.addEventListener('click', () => fileInput.click());
dropZone.addEventListener('keydown', (event) => {
  if (event.key === 'Enter' || event.key === ' ') {
    event.preventDefault();
    fileInput.click();
  }
});
fileInput.addEventListener('change', () => {
  addFiles(fileInput.files);
  fileInput.value = '';
});
for (const eventName of ['dragenter', 'dragover']) {
  dropZone.addEventListener(eventName, (event) => {
    event.preventDefault();
    dropZone.classList.add('dragging');
  });
}
for (const eventName of ['dragleave', 'drop']) {
  dropZone.addEventListener(eventName, (event) => {
    event.preventDefault();
    dropZone.classList.remove('dragging');
  });
}
dropZone.addEventListener('drop', (event) => addFiles(event.dataTransfer.files));

function showError(message) {
  errorMessage.textContent = message;
  errorMessage.hidden = false;
}

function resetView() {
  controller?.abort();
  controller = null;
  activeJobId = null;
  selectedFiles = [];
  renderFiles();
  form.reset();
  emailOutput.value = '';
  verificationPanel.hidden = true;
  verificationList.replaceChildren();
  inputPanel.hidden = false;
  processingPanel.hidden = true;
  resultPanel.hidden = true;
  errorMessage.hidden = true;
  copyStatus.textContent = '';
}

function renderVerification(items) {
  verificationList.replaceChildren();
  verificationPanel.hidden = items.length === 0;
  verificationCount.textContent = items.length ? `(${items.length})` : '';
  for (const item of items) {
    const row = document.createElement('div');
    row.className = 'verification-item';
    const names = [...new Set((item.sources ?? []).map((source) => source.filename))];
    row.textContent = `${item.field.replaceAll('_', ' ')} — conflicting sources: ${names.join(', ')}`;
    verificationList.append(row);
  }
}

form.addEventListener('submit', async (event) => {
  event.preventDefault();
  if (!selectedFiles.length) return;
  errorMessage.hidden = true;
  inputPanel.hidden = true;
  resultPanel.hidden = true;
  processingPanel.hidden = false;
  progressText.textContent = `Reading ${selectedFiles.length} file${selectedFiles.length === 1 ? '' : 's'}...`;
  controller = new AbortController();
  activeJobId = crypto.randomUUID();
  const body = new FormData();
  body.append('jobId', activeJobId);
  body.append('supplemental', document.querySelector('#supplemental').value);
  selectedFiles.forEach((file) => body.append('documents', file, file.name));

  try {
    const response = await fetch('/api/extract', { method: 'POST', body, signal: controller.signal });
    if (!response.ok || !response.body) throw new Error('The local extractor could not start.');
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    let gotResult = false;
    while (true) {
      const { value, done } = await reader.read();
      buffer += decoder.decode(value ?? new Uint8Array(), { stream: !done });
      const lines = buffer.split('\n');
      buffer = lines.pop() ?? '';
      for (const line of lines) {
        if (!line.trim()) continue;
        const message = JSON.parse(line);
        if (message.type === 'progress') progressText.textContent = message.message;
        if (message.type === 'error') throw new Error(message.message);
        if (message.type === 'cancelled') throw Object.assign(new Error(message.message), { name: 'AbortError' });
        if (message.type === 'result') {
          gotResult = true;
          emailOutput.value = message.email;
          renderVerification(message.verification ?? []);
          resultSummary.textContent = `${message.summary.documents} document${message.summary.documents === 1 ? '' : 's'} · ${message.summary.pages} page${message.summary.pages === 1 ? '' : 's'}${message.summary.cacheHits ? ` · ${message.summary.cacheHits} from local cache` : ''}${message.summary.ocrPages ? ` · ${message.summary.ocrPages} OCR page${message.summary.ocrPages === 1 ? '' : 's'}` : ''}`;
          processingPanel.hidden = true;
          resultPanel.hidden = false;
        }
      }
      if (done) break;
    }
    if (!gotResult) throw new Error('Extraction ended before a result was produced.');
  } catch (error) {
    processingPanel.hidden = true;
    inputPanel.hidden = false;
    if (error.name !== 'AbortError') {
      const offline = error instanceof TypeError || /network|fetch|failed to connect/i.test(error.message ?? '');
      showError(offline
        ? 'The local service is not running. Double-click start-contract-intake.cmd, then reload this page.'
        : (error.message || 'The packet could not be read.'));
    }
  } finally {
    controller = null;
    activeJobId = null;
  }
});

cancelButton.addEventListener('click', async () => {
  const jobId = activeJobId;
  controller?.abort();
  if (jobId) fetch(`/api/cancel/${encodeURIComponent(jobId)}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' }).catch(() => {});
  processingPanel.hidden = true;
  inputPanel.hidden = false;
});

copyButton.addEventListener('click', async () => {
  try {
    await navigator.clipboard.writeText(emailOutput.value);
  } catch {
    emailOutput.focus();
    emailOutput.select();
    document.execCommand('copy');
  }
  copyStatus.textContent = 'Copied to clipboard';
  setTimeout(() => { copyStatus.textContent = ''; }, 2200);
});

restartButton.addEventListener('click', resetView);
