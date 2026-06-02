/* Users admin screen (admin.html → Settings → Users). Talks to the admin-only
   /api/users endpoints using the logged-in admin's JWT. Renders into #eg-users-root. */
(function () {
  'use strict';
  var ROLES = ['seller', 'operator', 'admin', 'warehouse', 'designer'];
  function token() { return localStorage.getItem('eg_token') || ''; }
  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
  function api(path, opts) {
    opts = opts || {};
    var h = { 'Content-Type': 'application/json' };
    if (token()) h.Authorization = 'Bearer ' + token();
    return fetch('/api' + path, { method: opts.method || 'GET', headers: h, body: opts.body ? JSON.stringify(opts.body) : undefined })
      .then(function (r) { return r.json().catch(function () { return {}; }).then(function (d) { return r.ok ? { data: d, error: null } : { data: null, error: d.error || ('HTTP ' + r.status) }; }); })
      .catch(function (e) { return { data: null, error: e.message }; });
  }
  function msg(t, ok) { var m = document.getElementById('eg-users-msg'); if (m) { m.textContent = t || ''; m.style.color = ok ? '#15803d' : '#dc2626'; } }

  window.EGAdminUsers = {
    load: function () {
      var root = document.getElementById('eg-users-root'); if (!root) return;
      root.innerHTML = '<div style="color:#9ca3af;font-size:13px;padding:8px">Loading users…</div>';
      api('/users').then(function (r) {
        if (r.error) {
          var hint = /403|Admin|signed in|HTTP 401/.test(r.error) ? ' — you must be logged in as an admin on this server.' : '';
          root.innerHTML = '<div style="color:#dc2626;font-size:13px;padding:8px">' + esc(r.error) + hint + '</div>';
          return;
        }
        EGAdminUsers._render(r.data || []);
      });
    },
    _render: function (users) {
      var root = document.getElementById('eg-users-root'); if (!root) return;
      var roleOpts = function (sel) { return ROLES.map(function (rr) { return '<option value="' + rr + '"' + (sel === rr ? ' selected' : '') + '>' + rr + '</option>'; }).join(''); };
      var rows = users.map(function (u) {
        return '<tr style="border-bottom:1px solid #f0ede9">'
          + '<td style="padding:9px 10px"><div style="font-weight:600;color:#191918">' + esc(u.name || '—') + '</div><div style="font-size:12px;color:#9ca3af">' + esc(u.email) + '</div></td>'
          + '<td style="padding:9px 10px"><select onchange="EGAdminUsers.setRole(\'' + u.id + '\',this.value)" class="select" style="font-size:13px;padding:4px 8px">' + roleOpts(u.role) + '</select></td>'
          + '<td style="padding:9px 10px;font-size:12px;color:#9ca3af;white-space:nowrap">' + (u.created_at ? String(u.created_at).slice(0, 10) : '') + '</td>'
          + '<td style="padding:9px 10px;text-align:right;white-space:nowrap">'
            + '<button onclick="EGAdminUsers.resetPw(\'' + u.id + '\',\'' + esc(u.email) + '\')" class="btn btn-out" style="font-size:12px;padding:3px 9px">Reset password</button> '
            + '<button onclick="EGAdminUsers.del(\'' + u.id + '\',\'' + esc(u.email) + '\')" title="Delete user" style="background:none;border:none;color:#c4c3be;cursor:pointer;font-size:17px;line-height:1;padding:2px 6px" onmouseover="this.style.color=\'#dc2626\'" onmouseout="this.style.color=\'#c4c3be\'">&times;</button>'
          + '</td></tr>';
      }).join('');
      root.innerHTML =
        '<div style="display:flex;gap:8px;align-items:flex-end;flex-wrap:wrap;margin-bottom:16px;padding:14px;background:#faf9f7;border:1px solid #e5e4e0;border-radius:10px">'
          + '<div><label style="font-size:11.5px;font-weight:600;color:#6b7280;display:block;margin-bottom:4px">Email</label><input id="nu-email" class="input" placeholder="person@example.com" style="font-size:13px"></div>'
          + '<div><label style="font-size:11.5px;font-weight:600;color:#6b7280;display:block;margin-bottom:4px">Name</label><input id="nu-name" class="input" placeholder="Name" style="font-size:13px;width:130px"></div>'
          + '<div><label style="font-size:11.5px;font-weight:600;color:#6b7280;display:block;margin-bottom:4px">Password</label><input id="nu-pass" class="input" placeholder="8+ chars" style="font-size:13px"></div>'
          + '<div><label style="font-size:11.5px;font-weight:600;color:#6b7280;display:block;margin-bottom:4px">Role</label><select id="nu-role" class="select" style="font-size:13px">' + roleOpts('seller') + '</select></div>'
          + '<button onclick="EGAdminUsers.add()" class="btn btn-dk" style="font-size:13px">+ Add user</button>'
        + '</div>'
        + '<div id="eg-users-msg" style="font-size:12.5px;margin-bottom:8px;min-height:16px"></div>'
        + '<div class="card" style="overflow:hidden;padding:0"><table style="width:100%;border-collapse:collapse">'
          + '<thead><tr style="background:#faf9f7;border-bottom:1px solid #e5e4e0">'
            + '<th style="text-align:left;padding:8px 10px;font-size:10.5px;color:#9ca3af;text-transform:uppercase;letter-spacing:.05em">User</th>'
            + '<th style="text-align:left;padding:8px 10px;font-size:10.5px;color:#9ca3af;text-transform:uppercase;letter-spacing:.05em">Role</th>'
            + '<th style="text-align:left;padding:8px 10px;font-size:10.5px;color:#9ca3af;text-transform:uppercase;letter-spacing:.05em">Joined</th><th></th></tr></thead>'
          + '<tbody>' + (rows || '<tr><td colspan="4" style="padding:16px;color:#9ca3af;font-size:13px">No users yet.</td></tr>') + '</tbody></table></div>';
    },
    setRole: function (id, role) { api('/users/' + id, { method: 'PATCH', body: { role: role } }).then(function (r) { msg(r.error ? ('Error: ' + r.error) : ('Role updated → ' + role), !r.error); }); },
    add: function () {
      var email = (document.getElementById('nu-email').value || '').trim();
      var name = (document.getElementById('nu-name').value || '').trim();
      var pass = document.getElementById('nu-pass').value, role = document.getElementById('nu-role').value;
      if (!email || !pass) { msg('Email and password are required', false); return; }
      if (pass.length < 8) { msg('Password must be at least 8 characters', false); return; }
      api('/users', { method: 'POST', body: { email: email, name: name, password: pass, role: role } }).then(function (r) {
        if (r.error) { msg('Error: ' + r.error, false); return; }
        EGAdminUsers.load(); setTimeout(function () { msg('Created ' + email, true); }, 200);
      });
    },
    resetPw: function (id, email) {
      var p = prompt('New password for ' + email + ' (min 8 characters):'); if (p == null) return;
      if (p.length < 8) { msg('Password must be at least 8 characters', false); return; }
      api('/users/' + id, { method: 'PATCH', body: { password: p } }).then(function (r) { msg(r.error ? ('Error: ' + r.error) : ('Password reset for ' + email), !r.error); });
    },
    del: function (id, email) {
      if (!confirm('Delete ' + email + '? This cannot be undone.')) return;
      api('/users/' + id, { method: 'DELETE' }).then(function (r) { if (r.error) { msg('Error: ' + r.error, false); return; } EGAdminUsers.load(); setTimeout(function () { msg('Deleted ' + email, true); }, 200); });
    }
  };
})();
