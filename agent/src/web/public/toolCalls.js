// Tool-call rendering for the chat UI (index.html), shared by the session
// history and the live SSE stream.
//
//   ▸ 🔧 Tools (2): web_search, fetch_page        ← outer block, collapsed
//       ▸ web_search {"query":"dogecoin pr…"}  👁   ← one row per call, collapsed
//           {"results":[{"title":"…              ← trimmed result when opened
//
// The eye button opens #toolCallModal with the full arguments and result.
// Everything is written with textContent — tool output is untrusted.

var TOOL_ARGS_PREVIEW = 80;
var TOOL_RESULT_PREVIEW = 300;

function trimText(text, max) {
  return text.length > max ? text.slice(0, max) + '…' : text;
}

// Arguments arrive parsed (objects) from our providers, but a raw JSON string
// is possible; parse it so the modal can pretty-print either way.
function toolValueText(value, isPretty) {
  if (value === undefined || value === null) return '';
  if (typeof value === 'string') {
    try { value = JSON.parse(value); } catch { return value; }
    if (typeof value === 'string') return value;
  }
  return isPretty ? JSON.stringify(value, null, 2) : JSON.stringify(value);
}

function createToolCallsBlock() {
  var block = document.createElement('div');
  block.className = 'thinking-block tool-calls';

  var toggle = document.createElement('div');
  toggle.className = 'thinking-toggle';
  var list = document.createElement('div');
  list.className = 'tool-call-list';
  toggle.onclick = function() { list.classList.toggle('open'); };
  block.appendChild(toggle);
  block.appendChild(list);

  var calls = [];

  function updateSummary() {
    toggle.textContent = '🔧 Tools (' + calls.length + '): ' + calls.map(function(c) { return c.name; }).join(', ');
  }

  function renderResult(call) {
    call.body.textContent = call.hasResult
      ? trimText(toolValueText(call.result, true), TOOL_RESULT_PREVIEW)
      : 'Waiting for result…';
  }

  function add(name, args, result) {
    var call = { name: name, args: args, result: result, hasResult: arguments.length > 2 };

    var item = document.createElement('div');
    item.className = 'tool-call';
    var head = document.createElement('div');
    head.className = 'tool-call-head';

    var itemToggle = document.createElement('button');
    itemToggle.type = 'button';
    itemToggle.className = 'tool-call-toggle';
    var nameEl = document.createElement('span');
    nameEl.className = 'tool-call-name';
    nameEl.textContent = name;
    var argsEl = document.createElement('span');
    argsEl.className = 'tool-call-args';
    argsEl.textContent = trimText(toolValueText(args, false), TOOL_ARGS_PREVIEW);
    itemToggle.appendChild(nameEl);
    itemToggle.appendChild(argsEl);

    var eye = document.createElement('button');
    eye.type = 'button';
    eye.className = 'tool-call-eye';
    eye.title = 'Show full details';
    eye.setAttribute('aria-label', 'Show full details of ' + name);
    eye.textContent = '👁';
    eye.onclick = function() { openToolCallModal(call); };

    call.body = document.createElement('pre');
    call.body.className = 'tool-call-body';
    itemToggle.onclick = function() { item.classList.toggle('open'); };

    head.appendChild(itemToggle);
    head.appendChild(eye);
    item.appendChild(head);
    item.appendChild(call.body);
    list.appendChild(item);

    calls.push(call);
    renderResult(call);
    updateSummary();
  }

  // Calls run one after another in the order the model listed them, and a
  // result only carries the tool name — so it belongs to the oldest pending
  // call with that name.
  function setResult(name, result) {
    var call = calls.find(function(c) { return !c.hasResult && c.name === name; });
    if (!call) return;
    call.result = result;
    call.hasResult = true;
    renderResult(call);
  }

  return {
    el: block,
    add: add,
    setResult: setResult,
    expand: function() { list.classList.add('open'); },
    collapse: function() { list.classList.remove('open'); },
  };
}

function openToolCallModal(call) {
  document.getElementById('toolCallModalTitle').textContent = call.name;
  document.getElementById('toolCallModalArgs').textContent = toolValueText(call.args, true) || '(none)';
  document.getElementById('toolCallModalResult').textContent = call.hasResult
    ? toolValueText(call.result, true)
    : 'Waiting for result…';
  document.getElementById('toolCallModal').classList.add('open');
}

function closeToolCallModal() {
  document.getElementById('toolCallModal').classList.remove('open');
}

document.addEventListener('keydown', function(e) {
  if (e.key === 'Escape') closeToolCallModal();
});
