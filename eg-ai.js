/* eg-ai.js — SHARED bring-your-own-AI-key layer.
   Sellers add their OWN model key(s) in Settings; the Scout / title tools use whichever key
   is present — never the platform owner's API. Any provider works (it's just text), so we
   don't require Claude specifically. Keys live in localStorage on the seller's own device.
   Shared by seller + admin so the Scout modal never has to be rebuilt per role. */
(function (g) {
  'use strict';
  if (g.EGAI) return;
  var KEY = 'eg_ai_keys';
  // Order = priority: the first provider with a key is the "active" one for generation.
  var PROVIDERS = [
    { id: 'openai',    name: 'OpenAI',            modelPh: 'gpt-4o-mini' },
    { id: 'anthropic', name: 'Anthropic (Claude)', modelPh: 'claude-haiku-4-5' },
    { id: 'google',    name: 'Google Gemini',     modelPh: 'gemini-1.5-flash' }
  ];
  function load() { try { return JSON.parse(localStorage.getItem(KEY) || '{}'); } catch (e) { return {}; } }
  function save(cfg) { try { localStorage.setItem(KEY, JSON.stringify(cfg || {})); } catch (e) {} }
  // The provider to actually generate with: first configured key, honoring PROVIDERS order.
  function active() {
    var c = load();
    for (var i = 0; i < PROVIDERS.length; i++) {
      var p = PROVIDERS[i];
      if (c[p.id] && c[p.id].key) return { provider: p.id, name: p.name, key: c[p.id].key, model: (c[p.id].model || p.modelPh) };
    }
    return null;
  }
  // Call the seller's OWN provider directly from the browser (their key never touches our server).
  // Returns the generated text, or throws. OpenAI/Google allow browser CORS; Anthropic needs the
  // explicit direct-browser-access header.
  async function _post(url, headers, body) {
    var r = await fetch(url, { method: 'POST', headers: headers, body: JSON.stringify(body) });
    var d = await r.json().catch(function () { return {}; });
    if (!r.ok) { throw new Error((d && d.error && (d.error.message || d.error)) || ('AI request failed (' + r.status + ')')); }
    return d;
  }
  async function generate(prompt, opts) {
    opts = opts || {};
    var a = active();
    if (!a) throw new Error('No AI key set — add one in Settings → API Keys.');
    var maxTokens = opts.maxTokens || 500;
    if (a.provider === 'openai') {
      var d = await _post('https://api.openai.com/v1/chat/completions',
        { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + a.key },
        { model: a.model, messages: [{ role: 'user', content: prompt }], max_tokens: maxTokens, temperature: 0.7 });
      return ((d.choices && d.choices[0] && d.choices[0].message && d.choices[0].message.content) || '').trim();
    }
    if (a.provider === 'anthropic') {
      var d2 = await _post('https://api.anthropic.com/v1/messages',
        { 'Content-Type': 'application/json', 'x-api-key': a.key, 'anthropic-version': '2023-06-01', 'anthropic-dangerous-direct-browser-access': 'true' },
        { model: a.model, max_tokens: maxTokens, messages: [{ role: 'user', content: prompt }] });
      return ((d2.content && d2.content[0] && d2.content[0].text) || '').trim();
    }
    if (a.provider === 'google') {
      var d3 = await _post('https://generativelanguage.googleapis.com/v1beta/models/' + encodeURIComponent(a.model) + ':generateContent?key=' + encodeURIComponent(a.key),
        { 'Content-Type': 'application/json' },
        { contents: [{ parts: [{ text: prompt }] }] });
      return ((d3.candidates && d3.candidates[0] && d3.candidates[0].content && d3.candidates[0].content.parts && d3.candidates[0].content.parts[0] && d3.candidates[0].content.parts[0].text) || '').trim();
    }
    throw new Error('Unknown AI provider: ' + a.provider);
  }

  g.EGAI = {
    PROVIDERS: PROVIDERS,
    load: load,
    save: save,
    active: active,
    configured: function () { return !!active(); },
    generate: generate
  };
})(window);
