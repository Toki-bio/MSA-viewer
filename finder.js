/*
 * finder.js - one search bar for every function of the program.
 *
 * The list is read from the live menus each time it opens, so a new button is in it without anyone adding it here, and a
 * function that cannot run now (Edit tools outside Edit, Groups before grouping) shows dimmed. Enter does what a click on
 * the real control does: nothing here knows what any function means.
 */
(function () {
  'use strict';
  var KEY_NAMES = { Del: 'Delete', Up: 'ArrowUp', Down: 'ArrowDown', Left: 'ArrowLeft', Right: 'ArrowRight', Esc: 'Escape', PgUp: 'PageUp', PgDn: 'PageDown' };
  var input, panel, list, items = [], shown = [], active = -1, isOpen = false;

  function clean(t) { return String(t || '').replace(/\s+/g, ' ').replace(/[\s▾▼▸▶]+$/, '').trim(); }
  // the first clause of a tooltip names a control that only shows an icon or a letter
  function clause(t) { return clean(String(t || '').split(/[.:;(\n]/)[0]); }
  function poor(t) { return t.length < 3 || !/[a-z]{2}/i.test(t); }

  function labelOf(el) {
    var l = el.labels && el.labels[0];
    if (!l) return '';
    var c = l.cloneNode(true);   // a label around its control holds the options and the live value too
    c.querySelectorAll('select, input, output, textarea, [id]').forEach(function (n) { n.remove(); });
    return clean(c.textContent);
  }
  // a switch drawn as its label keeps the tooltip there
  function tipOf(el) {
    var l = el.labels && el.labels[0];
    return el.getAttribute('title') || (l && l.getAttribute('title')) || '';
  }
  function nameOf(el) {
    if (el.dataset.find) return el.dataset.find;
    var tip = clause(tipOf(el) || el.getAttribute('aria-label'));
    var own = el.matches('button, a, [role="button"]') ? clean(el.textContent) : labelOf(el);
    if (el.matches('.section-header')) own = clean((el.querySelector('span') || el).textContent);
    return poor(own) && tip ? tip : own || tip;
  }
  function sectionOf(el) {
    var s = el.closest('.menu-section');
    if (!s) return { el: null, name: 'Toolbar' };
    var h = s.querySelector('.section-header span');
    return { el: s, name: h ? clean(h.textContent) : 'Toolbar' };
  }
  function pathOf(el) {
    var sec = sectionOf(el), a = el.closest('.action-section');
    var sub = a && a.querySelector('.action-section-label');
    return sub ? sec.name + ' › ' + clean(sub.textContent) : sec.name;
  }
  // closed menus are normal; anything else hiding a control means it does not apply now
  function canRun(el) {
    if (el.disabled) return false;
    var drawn = el.matches('input[type="radio"], input[type="checkbox"]') && el.labels && el.labels[0] || el;
    for (var n = drawn; n && n.id !== 'controls'; n = n.parentElement) {
      if (n.classList.contains('control-group')) { n = n.closest('.menu-section'); return !n || getComputedStyle(n).display !== 'none'; }
      if (n.hidden || getComputedStyle(n).display === 'none') return false;
    }
    return true;
  }

  function collect() {
    var controls = document.getElementById('controls'), out = [], seen = {};
    function add(it) {
      var k = (it.name + '|' + it.path + '|' + (it.tip || '')).toLowerCase();   // a slider and its number box are one
      if (!it.name || seen[k]) return;
      seen[k] = 1;
      var d = clause(it.tip);
      it.desc = d && d.toLowerCase() !== it.name.toLowerCase() && !it.deep ? d : '';
      it.hay = (it.name + ' ' + it.path + ' ' + (it.tip || '') + ' ' + (it.hint || '')).toLowerCase();
      it.low = it.name.toLowerCase();
      it.lowDesc = it.desc.toLowerCase();
      out.push(it);
    }
    controls.querySelectorAll('button, select, input, a[href], [role="button"], #dropZone, .section-header').forEach(function (el) {
      if (el.closest('#finderBox')) return;
      var type = el.tagName === 'INPUT' ? el.type : '';
      if (type === 'file' || type === 'hidden') return;
      var tip = tipOf(el), key = /\(((?:Ctrl|Alt|Shift)\+[^)]+)\)/.exec(tip);
      var kind = el.matches('.section-header') ? 'menu' : type === 'checkbox' || type === 'radio' ? 'check' : el.tagName === 'INPUT' || el.tagName === 'SELECT' ? 'field' : 'do';
      var it = { el: el, kind: kind, name: nameOf(el), path: pathOf(el), tip: tip, hint: key ? key[1] : '', ok: canRun(el) };
      add(it);
      if (el.tagName === 'SELECT') {
        Array.prototype.forEach.call(el.options, function (o) {
          if (o.value !== '') add({ el: el, kind: 'option', value: o.value, deep: true, name: it.name + ': ' + clean(o.textContent), path: it.path, tip: tip, ok: it.ok && !o.disabled });
        });
      }
    });
    // what has only a key; a key of a button already listed goes on that button
    var taken = {}, byName = {}, plain = function (t) { return t.toLowerCase().replace(/[^a-z]/g, ''); };
    out.forEach(function (it) { if (it.hint) taken[it.hint] = 1; if (it.kind === 'do') byName[plain(it.name)] = it; });
    taken['Ctrl+K'] = 1;   // this bar
    controls.querySelectorAll('.keys-grid strong').forEach(function (k) {
      var d = k.nextElementSibling, key = clean(k.textContent);
      if (!d || taken[key]) return;
      var same = byName[plain(d.textContent)];
      if (same) same.hint = same.hint || key;
      else add({ kind: 'key', name: clean(d.textContent), path: 'Keys', hint: key, ok: true });
    });
    return out;
  }

  // Exact start of the name, then a word in it, then anywhere in it, then only in the tooltip or menu
  function rank(it, q, words) {
    var i;
    for (i = 0; i < words.length; i++) if (it.hay.indexOf(words[i]) < 0) return -1;
    var t = it.low + ' ' + it.lowDesc;
    if (it.low.indexOf(q) === 0 || it.lowDesc.indexOf(q) === 0) return 0;
    if ((' ' + t).indexOf(' ' + q) >= 0) return 1;
    if (t.indexOf(q) >= 0) return 2;
    for (i = 0; i < words.length; i++) if (t.indexOf(words[i]) < 0) return 4;
    return 3;
  }

  function textNode(text, words, cls) {
    var span = document.createElement('span'), low = text.toLowerCase(), p = 0, marks = [];
    span.className = cls;
    words.forEach(function (w) { var i = low.indexOf(w); if (w && i >= 0) marks.push([i, i + w.length]); });
    marks.sort(function (a, b) { return a[0] - b[0]; }).forEach(function (m) {
      if (m[0] < p) return;
      span.appendChild(document.createTextNode(text.slice(p, m[0])));
      var b = document.createElement('b'); b.textContent = text.slice(m[0], m[1]); span.appendChild(b);
      p = m[1];
    });
    span.appendChild(document.createTextNode(text.slice(p)));
    return span;
  }
  function row(it, i, words, withPath) {
    var r = document.createElement('div');
    r.className = 'finder-row' + (it.ok ? '' : ' finder-off');
    r.id = 'finderRow' + i;
    r.setAttribute('role', 'option');
    r.setAttribute('aria-selected', 'false');
    r.dataset.i = i;
    if (it.tip) r.title = it.tip;
    var main = document.createElement('span');
    main.className = 'finder-main';
    main.appendChild(textNode(it.name, words, 'finder-name'));
    if (it.desc) main.appendChild(textNode(it.desc, words, 'finder-desc'));
    r.appendChild(main);
    var note = it.ok ? '' : 'not available now';
    if (it.ok && it.kind === 'check') note = it.el.checked ? 'on' : 'off';
    if (it.ok && it.kind === 'menu') note = 'menu';
    if (note || it.hint || withPath) {
      var s = document.createElement('span');
      s.className = 'finder-note';
      s.textContent = [note, it.hint, withPath ? it.path : ''].filter(Boolean).join('  ·  ');
      r.appendChild(s);
    }
    return r;
  }
  function render() {
    var q = input.value.trim().toLowerCase(), words = q.split(/\s+/).filter(Boolean);
    list.textContent = '';
    if (!q) {
      var order = [], by = {};
      items.forEach(function (it) {
        if (it.deep) return;
        var k = it.path.split(' › ')[0];
        if (!by[k]) { by[k] = []; order.push(k); }
        by[k].push(it);
      });
      shown = [];
      order.forEach(function (k) {
        var h = document.createElement('div');
        h.className = 'finder-head'; h.textContent = k;
        list.appendChild(h);
        // what can run first, in menu order
        by[k].filter(function (it) { return it.ok; }).concat(by[k].filter(function (it) { return !it.ok; }))
          .forEach(function (it) { list.appendChild(row(it, shown.length, [], false)); shown.push(it); });
      });
    } else {
      shown = items.map(function (it, i) { return { it: it, r: rank(it, q, words), i: i }; })
        .filter(function (x) { return x.r >= 0; })
        .sort(function (a, b) { return a.r - b.r || (a.it.ok === b.it.ok ? 0 : a.it.ok ? -1 : 1) || a.it.name.length - b.it.name.length || a.i - b.i; })
        .map(function (x) { return x.it; });
      shown.forEach(function (it, i) { list.appendChild(row(it, i, words, true)); });
      if (!shown.length) {
        var none = document.createElement('div');
        none.className = 'finder-none'; none.textContent = 'No function with that name';
        list.appendChild(none);
      }
    }
    select(q && shown.length ? 0 : -1);
    list.scrollTop = 0;
  }
  function select(i) {
    var old = list.querySelector('.finder-row.on');
    if (old) { old.classList.remove('on'); old.setAttribute('aria-selected', 'false'); }
    active = i;
    var r = i >= 0 ? document.getElementById('finderRow' + i) : null;
    if (r) { r.classList.add('on'); r.setAttribute('aria-selected', 'true'); r.scrollIntoView({ block: 'nearest' }); input.setAttribute('aria-activedescendant', r.id); }
    else input.removeAttribute('aria-activedescendant');
  }

  function open() {
    if (isOpen) return;
    isOpen = true;
    items = collect();
    var r = input.getBoundingClientRect(), w = Math.min(460, window.innerWidth - 16);
    panel.style.width = w + 'px';
    panel.style.left = Math.max(8, Math.min(r.right - w, window.innerWidth - w - 8)) + 'px';
    panel.style.top = (r.bottom + 3) + 'px';
    panel.style.maxHeight = (window.innerHeight - r.bottom - 14) + 'px';
    panel.hidden = false;
    input.setAttribute('aria-expanded', 'true');
    render();
  }
  function close() {
    if (!isOpen) return;
    isOpen = false;
    panel.hidden = true;
    input.setAttribute('aria-expanded', 'false');
    input.removeAttribute('aria-activedescendant');
    input.value = '';
  }

  // a field has no single action: open its menu and put the cursor in it
  function reveal(el) {
    var s = sectionOf(el).el;
    if (s && typeof openMenuSection === 'function') openMenuSection(s);
    if (el.matches('.section-header')) return;
    el.focus();
    el.scrollIntoView({ block: 'nearest' });
    el.classList.add('finder-flash');
    setTimeout(function () { el.classList.remove('finder-flash'); }, 1600);
  }
  function pressKey(combo) {
    var parts = combo.split('+'), key = parts.pop();
    if (/[\/ ]|click|drag|wheel|scroll/i.test(combo) || !key) { if (typeof showMessage === 'function') showMessage('Press ' + combo, 3000); return; }
    var k = KEY_NAMES[key] || (key.length === 1 ? key.toLowerCase() : key);
    document.dispatchEvent(new KeyboardEvent('keydown', {
      key: k, code: key.length === 1 ? 'Key' + key.toUpperCase() : k, bubbles: true, cancelable: true,
      ctrlKey: parts.indexOf('Ctrl') >= 0, altKey: parts.indexOf('Alt') >= 0, shiftKey: parts.indexOf('Shift') >= 0
    }));
  }
  function run(it) {
    if (!it) return;
    if (!it.ok) { if (typeof showMessage === 'function') showMessage(it.name + ' is not available now', 3000); return; }
    close();
    input.blur();
    if (it.kind === 'do' || it.kind === 'check') it.el.click();
    else if (it.kind === 'key') pressKey(it.hint);
    else if (it.kind === 'option') {
      it.el.value = it.value;
      it.el.dispatchEvent(new Event('input', { bubbles: true }));
      it.el.dispatchEvent(new Event('change', { bubbles: true }));
    } else reveal(it.el);
  }

  function init() {
    input = document.getElementById('finderInput');
    if (!input) return;
    panel = document.createElement('div');
    panel.id = 'finderPanel';
    panel.hidden = true;
    list = document.createElement('div');
    list.id = 'finderList';
    list.setAttribute('role', 'listbox');
    list.setAttribute('aria-label', 'Functions');
    panel.appendChild(list);
    document.body.appendChild(panel);
    input.setAttribute('aria-controls', 'finderList');

    input.addEventListener('focus', open);
    input.addEventListener('click', open);
    input.addEventListener('blur', close);
    input.addEventListener('input', function () { if (!isOpen) open(); render(); });
    input.addEventListener('keydown', function (e) {
      e.stopPropagation();   // typing here is not a shortcut of the alignment
      if (e.key === 'Enter') { e.preventDefault(); run(shown[active]); }
      else if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        e.preventDefault();
        if (shown.length) select((active + (e.key === 'ArrowDown' ? 1 : -1) + shown.length) % shown.length);
      }
    });
    list.addEventListener('mousedown', function (e) { e.preventDefault(); });   // the input keeps the focus
    list.addEventListener('click', function (e) {
      var r = e.target.closest('.finder-row');
      if (r) run(shown[+r.dataset.i]);
    });
    list.addEventListener('mousemove', function (e) {
      var r = e.target.closest('.finder-row');
      if (r && +r.dataset.i !== active) select(+r.dataset.i);
    });
    // on window, before the program's own Esc: that one hides every menu until the mouse moves
    window.addEventListener('keydown', function (e) {
      if (isOpen && e.key === 'Escape') {
        e.preventDefault();
        e.stopPropagation();
        close();
        input.blur();
      } else if ((e.ctrlKey || e.metaKey) && !e.shiftKey && !e.altKey && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        e.stopPropagation();
        input.focus();
        input.select();
      }
    }, true);
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init); else init();
  window.ViewAlignFinder = { list: function () { return collect().map(function (it) { return { name: it.name, path: it.path, kind: it.kind, ok: it.ok, hint: it.hint, id: it.el && it.el.id, deep: !!it.deep }; }); } };
})();
