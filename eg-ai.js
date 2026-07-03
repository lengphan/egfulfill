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
  g.EGAI = {
    PROVIDERS: PROVIDERS,
    load: load,
    save: save,
    active: active,
    configured: function () { return !!active(); }
    // generate(prompt) is added with the Scout "Make" flow — it reads active() and calls
    // that provider directly from the browser with the seller's own key.
  };
})(window);
