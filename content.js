/**
 * Tethernet Content Script
 * DOM interaction, WeakRef element registry, accessibility tree.
 */

(function() {
  'use strict';

  if (window.__tethernet_injected) return;
  window.__tethernet_injected = true;

  // --- WeakRef element registry ---
  // Stable tref_N handles that survive React re-renders and CSS class changes.
  // Exposed on window so execute_script can pre-register elements.
  if (!window.__tethernetRefCounter) {
    window.__tethernetRefCounter = 0;
    window.__tethernetRefs = new Map();      // tref_N → WeakRef<Element>
    window.__tethernetReverse = new WeakMap(); // Element → tref_N
  }

  function registerElement(el) {
    if (window.__tethernetReverse.has(el)) return window.__tethernetReverse.get(el);
    const id = `tref_${++window.__tethernetRefCounter}`;
    window.__tethernetRefs.set(id, new WeakRef(el));
    window.__tethernetReverse.set(el, id);
    return id;
  }

  // Accept either a CSS selector or a tref_ handle
  function resolveElement(selectorOrRef) {
    if (typeof selectorOrRef === 'string' && selectorOrRef.startsWith('tref_')) {
      const ref = window.__tethernetRefs.get(selectorOrRef);
      if (!ref) throw new Error(`Ref not found: ${selectorOrRef}`);
      const el = ref.deref();
      if (!el) throw new Error(`Element GC'd: ${selectorOrRef}`);
      return el;
    }
    const el = document.querySelector(selectorOrRef);
    if (!el) throw new Error(`Element not found: ${selectorOrRef}`);
    registerElement(el);
    return el;
  }

  // Exposed on document (shared between isolated + main worlds) so execute_script can call them

  // Pre-register an element and get its stable tref_ handle
  document.__tethernetGetRef = (selector) => {
    const el = document.querySelector(selector);
    if (!el) return null;
    const id = registerElement(el);
    const r = el.getBoundingClientRect();
    return { refId: id, tag: el.tagName.toLowerCase(), role: getRole(el),
      label: getLabel(el), rect: { x: r.x, y: r.y, width: r.width, height: r.height } };
  };

  // Build accessibility tree — callable from execute_script
  // params: { filter: 'interactive'|'all'|undefined, depth, charLimit, selector }
  document.__tethernetAccessibilityTree = (params) => handleGetAccessibilityTree(params || {});

  // Returns boundingRect for error recovery (model can screenshot-verify and retry)
  function elementRect(el) {
    const r = el.getBoundingClientRect();
    return { x: r.x, y: r.y, width: r.width, height: r.height,
      top: r.top, right: r.right, bottom: r.bottom, left: r.left };
  }

  function safeResolve(selectorOrRef) {
    const el = resolveElement(selectorOrRef);
    return { el, refId: registerElement(el), rect: elementRect(el) };
  }

  // --- Message handler ---

  chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    const { action, params } = message;
    handleCommand(action, params)
      .then(result => sendResponse(result))
      .catch(error => {
        // Try to include bounding rect for coordinate-based retry
        let rect = null;
        try {
          const sel = params?.selector || params?.refId;
          if (sel) rect = elementRect(resolveElement(sel));
        } catch (_) { /* ignore */ }
        sendResponse({ error: error.message, ...(rect ? { rect } : {}) });
      });
    return true;
  });

  async function handleCommand(action, params) {
    switch (action) {
      case 'ping':                return { pong: true };
      case 'click_element':       return handleClickElement(params);
      case 'type_text':           return handleTypeText(params);
      case 'press_key':           return handlePressKey(params);
      case 'scroll':              return handleScroll(params);
      case 'scroll_to_element':   return handleScrollToElement(params);
      case 'hover_element':       return handleHoverElement(params);
      case 'focus_element':       return handleFocusElement(params);
      case 'select_option':       return handleSelectOption(params);
      case 'set_checkbox':        return handleSetCheckbox(params);
      case 'get_element_bounds':  return handleGetElementBounds(params);
      case 'get_ref':             return handleGetRef(params);
      case 'get_accessibility_tree': return handleGetAccessibilityTree(params);
      case 'find_elements':          return handleFindElements(params);
      default: throw new Error(`Unknown action: ${action}`);
    }
  }

  // --- Interaction handlers ---

  function handleClickElement(params) {
    const { el, refId, rect } = safeResolve(params.selector);
    el.click();
    return { success: true, refId, rect };
  }

  function handleTypeText(params) {
    const { el, refId } = safeResolve(params.selector);
    if (params.clear) el.value = '';
    el.focus();
    el.value += params.text;
    el.dispatchEvent(new Event('input', { bubbles: true }));
    el.dispatchEvent(new Event('change', { bubbles: true }));
    return { success: true, refId };
  }

  function handlePressKey(params) {
    const el = params.selector ? resolveElement(params.selector) : document.activeElement;
    const opts = {
      key: params.key, code: params.key,
      ctrlKey: params.ctrlKey || false, shiftKey: params.shiftKey || false,
      altKey: params.altKey || false, metaKey: params.metaKey || false,
      bubbles: true, cancelable: true
    };
    el.dispatchEvent(new KeyboardEvent('keydown', opts));
    el.dispatchEvent(new KeyboardEvent('keypress', opts));
    el.dispatchEvent(new KeyboardEvent('keyup', opts));
    // For Enter on a form input, trigger real form submission (works from isolated world,
    // no unsafe-eval needed — bypasses CSP restriction that blocks execute_script)
    if (params.key === 'Enter' &&
        (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA') &&
        el.type !== 'button' && el.type !== 'submit' && el.type !== 'reset') {
      const form = el.closest('form');
      if (form) {
        const submitBtn = form.querySelector('[type="submit"]');
        if (submitBtn) submitBtn.click();
        else if (form.requestSubmit) form.requestSubmit();
        else form.submit();
      }
    }
    return { success: true };
  }

  function handleScroll(params) {
    window.scrollTo(params.x || 0, params.y || 0);
    return { success: true };
  }

  function handleScrollToElement(params) {
    resolveElement(params.selector).scrollIntoView({ behavior: params.behavior || 'smooth', block: 'center' });
    return { success: true };
  }

  function handleHoverElement(params) {
    const { el, refId, rect } = safeResolve(params.selector);
    const opts = { bubbles: true, cancelable: true,
      clientX: rect.left + rect.width / 2, clientY: rect.top + rect.height / 2 };
    el.dispatchEvent(new MouseEvent('mouseover', opts));
    el.dispatchEvent(new MouseEvent('mouseenter', opts));
    return { success: true, refId };
  }

  function handleFocusElement(params) {
    const { el, refId } = safeResolve(params.selector);
    el.focus();
    return { success: true, refId };
  }

  function handleSelectOption(params) {
    const { el, refId } = safeResolve(params.selector);
    if (el.tagName !== 'SELECT') throw new Error('Element is not a SELECT');
    if (params.value !== undefined) el.value = params.value;
    else if (params.index !== undefined) el.selectedIndex = params.index;
    el.dispatchEvent(new Event('change', { bubbles: true }));
    return { success: true, refId };
  }

  function handleSetCheckbox(params) {
    const { el, refId } = safeResolve(params.selector);
    if (el.type !== 'checkbox' && el.type !== 'radio')
      throw new Error('Element is not a checkbox or radio');
    el.checked = params.checked;
    el.dispatchEvent(new Event('change', { bubbles: true }));
    return { success: true, refId };
  }

  function handleGetElementBounds(params) {
    const { refId, rect } = safeResolve(params.selector);
    return { ...rect, refId };
  }

  function handleGetRef(params) {
    const { el, refId, rect } = safeResolve(params.selector);
    const tag = el.tagName.toLowerCase();
    const role = getRole(el);
    const label = getLabel(el);
    return { refId, selector: params.selector, tag, role, label, rect };
  }

  // --- Accessibility tree ---

  // ARIA role mapping
  function getRole(el) {
    const explicit = el.getAttribute('role');
    if (explicit) return explicit;
    const map = {
      A: 'link', BUTTON: 'button', INPUT: 'textbox', SELECT: 'combobox',
      TEXTAREA: 'textbox', H1: 'heading', H2: 'heading', H3: 'heading',
      H4: 'heading', H5: 'heading', H6: 'heading', IMG: 'image',
      NAV: 'navigation', MAIN: 'main', HEADER: 'banner', FOOTER: 'contentinfo',
      ASIDE: 'complementary', FORM: 'form', TABLE: 'table',
      UL: 'list', OL: 'list', LI: 'listitem', ARTICLE: 'article',
      SECTION: 'region', LABEL: 'label'
    };
    return map[el.tagName] || 'generic';
  }

  // Human-readable label extraction (priority chain)
  function getLabel(el) {
    if (el.getAttribute('aria-label')) return el.getAttribute('aria-label');
    if (el.getAttribute('placeholder')) return el.getAttribute('placeholder');
    if (el.getAttribute('title')) return el.getAttribute('title');
    if (el.getAttribute('alt')) return el.getAttribute('alt');
    if (el.id) {
      const lbl = document.querySelector(`label[for="${el.id}"]`);
      if (lbl) return [...lbl.childNodes].filter(n => n.nodeType === 3)
        .map(n => n.textContent.trim()).join(' ').slice(0, 80);
    }
    // Input wrapped inside a label: <label>text<input></label>
    const wrappingLabel = el.closest('label');
    if (wrappingLabel) {
      const t = [...wrappingLabel.childNodes]
        .filter(n => n.nodeType === 3).map(n => n.textContent.trim()).filter(Boolean).join(' ');
      if (t) return t.slice(0, 80);
    }
    // Preceding sibling label without for: <label>text</label><input>
    const prev = el.previousElementSibling;
    if (prev && prev.tagName === 'LABEL') return prev.textContent.trim().slice(0, 80);
    // Table layout: <td>label text</td><td><input></td>
    const parentTd = el.parentElement;
    if (parentTd && parentTd.tagName === 'TD') {
      const prevTd = parentTd.previousElementSibling;
      if (prevTd) return prevTd.textContent.trim().slice(0, 80);
    }
    if ((el.tagName === 'INPUT' && (el.type === 'submit' || el.type === 'text')) && el.value)
      return el.value.slice(0, 50);
    const text = el.textContent?.trim();
    if (text) return text.slice(0, 100);
    return '';
  }

  function isVisible(el) {
    const s = getComputedStyle(el);
    return s.display !== 'none' && s.visibility !== 'hidden' &&
      s.opacity !== '0' && el.offsetWidth > 0 && el.offsetHeight > 0;
  }

  function isInteractive(el) {
    if (['A','BUTTON','INPUT','SELECT','TEXTAREA','DETAILS','SUMMARY'].includes(el.tagName)) return true;
    if (el.getAttribute('onclick') || el.getAttribute('tabindex')) return true;
    const r = el.getAttribute('role');
    if (r === 'button' || r === 'link') return true;
    if (el.getAttribute('contenteditable') === 'true') return true;
    return false;
  }

  const SEMANTIC_TAGS = new Set(['H1','H2','H3','H4','H5','H6','NAV','MAIN','HEADER','FOOTER','SECTION','ARTICLE','ASIDE']);
  const SKIP_TAGS = new Set(['SCRIPT','STYLE','META','LINK','TITLE','NOSCRIPT']);

  function inViewport(el) {
    const r = el.getBoundingClientRect();
    return r.bottom > 0 && r.top < window.innerHeight &&
           r.right > 0 && r.left < window.innerWidth;
  }

  function buildTree(root, filter, depth, charLimit) {
    const lines = [];
    let charCount = 0;

    function traverse(el, indent) {
      if (charLimit && charCount >= charLimit) return;
      if (SKIP_TAGS.has(el.tagName)) return;
      if (el.getAttribute('aria-hidden') === 'true' && filter !== 'all') return;
      if (!isVisible(el) && filter !== 'all') return;
      if (filter !== 'all' && !inViewport(el) && !el.closest('[tabindex]')) {
        // Still recurse, but skip non-interactive non-viewport elements in default mode
        if (filter !== 'interactive') {
          for (const child of el.children) traverse(child, indent);
        }
        return;
      }

      const interactive = isInteractive(el);
      const semantic = SEMANTIC_TAGS.has(el.tagName);
      const hasText = (el.childNodes.length === 1 && el.firstChild.nodeType === 3 &&
                       el.firstChild.textContent.trim().length > 0);

      const include = filter === 'interactive' ? interactive
                    : filter === 'all' ? true
                    : (interactive || semantic || hasText);

      if (include) {
        const role = getRole(el);
        const label = getLabel(el);
        const refId = registerElement(el);
        const attrs = [];
        if (el.tagName === 'A' && el.href) attrs.push(`href="${el.href.replace(location.origin, '')}"`);
        if (el.tagName === 'INPUT') attrs.push(`type="${el.type}"`);
        if (el.placeholder) attrs.push(`placeholder="${el.placeholder}"`);
        if (el.value && el.tagName === 'INPUT' && el.type !== 'password') attrs.push(`value="${el.value.slice(0,50)}"`);

        const line = `${'  '.repeat(indent)}${role} "${label.slice(0,80)}" [${refId}]` +
          (attrs.length ? ' ' + attrs.join(' ') : '');
        lines.push(line);
        charCount += line.length;
      }

      if (indent < depth) {
        for (const child of el.children) traverse(child, indent + (include ? 1 : 0));
      }
    }

    traverse(root, 0);
    return lines.join('\n');
  }

  function handleGetAccessibilityTree(params) {
    const { filter, depth = 15, charLimit, selector } = params;
    const root = selector ? resolveElement(selector) : document.body;
    const tree = buildTree(root, filter, depth, charLimit);
    return {
      pageContent: tree,
      viewport: { width: window.innerWidth, height: window.innerHeight },
      elementCount: window.__tethernetRefCounter,
    };
  }

  // --- Find elements by natural language description ---

  function handleFindElements(params) {
    const { description = '', maxResults = 3, filter = 'interactive' } = params;
    const tokens = description.toLowerCase().split(/\s+/).filter(t => t.length > 1);
    const filterInteractive = filter === 'interactive';

    const SKIP = new Set(['SCRIPT','STYLE','META','LINK','NOSCRIPT','HEAD','TITLE','SVG','PATH']);
    const INTERACTIVE_TAGS = new Set(['A','BUTTON','INPUT','SELECT','TEXTAREA','DETAILS','SUMMARY']);

    function isInteractiveEl(el) {
      if (INTERACTIVE_TAGS.has(el.tagName)) return true;
      const role = el.getAttribute('role');
      if (role === 'button' || role === 'link' || role === 'checkbox' || role === 'radio' || role === 'combobox') return true;
      if (el.getAttribute('onclick') !== null || el.getAttribute('tabindex') !== null) return true;
      if (el.getAttribute('contenteditable') === 'true') return true;
      return false;
    }

    function collectText(el) {
      const parts = [];
      ['aria-label','placeholder','title','alt','data-testid','data-stid','name','id'].forEach(a => {
        const v = el.getAttribute(a); if (v) parts.push(v);
      });
      // Adjacent text labels (mirrors getLabel adjacent-text logic)
      const wrappingLabel = el.closest('label');
      if (wrappingLabel) {
        const t = [...wrappingLabel.childNodes]
          .filter(n => n.nodeType === 3).map(n => n.textContent.trim()).filter(Boolean).join(' ');
        if (t) parts.push(t);
      }
      const prev = el.previousElementSibling;
      if (prev && prev.tagName === 'LABEL') parts.push(prev.textContent.trim());
      const parentTd = el.parentElement;
      if (parentTd && parentTd.tagName === 'TD') {
        const prevTd = parentTd.previousElementSibling;
        if (prevTd) parts.push(prevTd.textContent.trim());
      }
      const txt = (el.textContent || '').trim();
      if (txt.length <= 200) parts.push(txt);
      parts.push(getRole(el));
      parts.push(el.tagName.toLowerCase());
      return parts.join(' ').toLowerCase();
    }

    function scoreText(text) {
      if (!tokens.length) return 0;
      const hits = tokens.filter(t => text.includes(t)).length;
      const phraseBonus = text.includes(description.toLowerCase()) ? 0.25 : 0;
      return Math.min(1, hits / tokens.length + phraseBonus);
    }

    const candidates = [];
    for (const el of document.querySelectorAll('*')) {
      if (SKIP.has(el.tagName)) continue;
      if (!isVisible(el)) continue;
      const interactive = isInteractiveEl(el);
      if (filterInteractive && !interactive) continue;
      const s = scoreText(collectText(el));
      if (s > 0) candidates.push({ el, score: s, interactive });
    }

    candidates.sort((a, b) => {
      if (a.interactive !== b.interactive) return b.interactive ? 1 : -1;
      return b.score - a.score;
    });

    const matches = candidates.slice(0, maxResults).map(c => {
      const refId = registerElement(c.el);
      const rect = elementRect(c.el);
      return {
        refId,
        score: Math.round(c.score * 100) / 100,
        role: getRole(c.el),
        label: getLabel(c.el).slice(0, 80),
        tag: c.el.tagName.toLowerCase(),
        interactive: c.interactive,
        rect,
      };
    });

    return { matches, description, totalCandidates: candidates.length };
  }

  // --- Autorun: ask service worker to execute site scripts in page's main world ---
  // Retry once after 500ms in case the SW was asleep when the first message was sent.
  const autorunMsg = { type: 'autorun_check', hostname: location.hostname };
  chrome.runtime.sendMessage(autorunMsg).catch(() =>
    setTimeout(() => chrome.runtime.sendMessage(autorunMsg).catch(() => {}), 500)
  );

  chrome.runtime.sendMessage({ type: 'content_script_ready' }).catch(() => {});

  // --- Passive interaction tracking ---
  let passiveActive = false;

  function passiveClickHandler(e) {
    const el = e.target;
    const tag = el.tagName ? el.tagName.toLowerCase() : '';
    const id = el.id ? `#${el.id}` : '';
    const cls = el.className && typeof el.className === 'string' ? `.${el.className.trim().split(/\s+/)[0]}` : '';
    chrome.runtime.sendMessage({
      type: 'passive_interaction',
      data: { kind: 'interaction', t: Date.now(), action: 'click', el: `${tag}${id}${cls}`, url: location.href },
    }).catch(() => {});
  }

  function passiveSubmitHandler() {
    chrome.runtime.sendMessage({
      type: 'passive_interaction',
      data: { kind: 'interaction', t: Date.now(), action: 'submit', url: location.href },
    }).catch(() => {});
  }

  chrome.runtime.onMessage.addListener((msg) => {
    if (msg.type === 'passive_enable' && !passiveActive) {
      passiveActive = true;
      document.addEventListener('click', passiveClickHandler, true);
      document.addEventListener('submit', passiveSubmitHandler, true);
    } else if (msg.type === 'passive_disable' && passiveActive) {
      passiveActive = false;
      document.removeEventListener('click', passiveClickHandler, true);
      document.removeEventListener('submit', passiveSubmitHandler, true);
    }
  });

  console.log('[Tethernet] Content script initialized');
})();
