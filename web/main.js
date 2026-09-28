import { $, element, getJson, syncAccounts, validPath } from './shared.js';
import { initFiles } from './files.js';
import { initPosts } from './posts.js';

const { updateCommands: updateFiles, ready: filesReady } = initFiles();
const posts = initPosts();
syncAccounts(() => { updateFiles(); posts.updateCommands(); });
updateFiles();
posts.updateCommands();

for (const button of document.querySelectorAll('[data-copy]')) {
    button.addEventListener('click', async () => {
        try {
            await navigator.clipboard.writeText($(button.dataset.copy + '-command').textContent);
            $('copy-status').textContent = button.dataset.copy + ' 복사됨';
        } catch (error) {
            $('copy-status').textContent = '복사 실패';
            console.error('Failed to copy command:', error);
        }
    });
}

const pages = new Map();
const pageUrl = name => '/pages/' + encodeURIComponent(name) + '/page.md';
let pageRequest = 0;

function renderPage(body, content, name) {
    const html = posts.markdown(content);
    if (html === null) { body.textContent = content; return; }
    body.innerHTML = html;
    const base = new URL(pageUrl(name), location.origin);
    for (const asset of body.querySelectorAll('[src]')) {
        const src = asset.getAttribute('src');
        if (src) asset.src = new URL(src, base).href;
    }
    for (const link of body.querySelectorAll('a[href]')) {
        const href = link.getAttribute('href');
        if (href.startsWith('#')) {
            link.addEventListener('click', event => {
                let id = href.slice(1);
                try { id = decodeURIComponent(id); } catch {}
                const heading = [...body.querySelectorAll('[id]')].find(node => node.id === id);
                if (heading) { event.preventDefault(); heading.scrollIntoView(); }
            });
        } else link.href = new URL(href, base).href;
    }
}

async function showPage(name, request) {
    const page = pages.get(name);
    try {
        const response = await fetch(pageUrl(name), { cache: 'no-store' });
        if (!response.ok) throw new Error('HTTP ' + response.status);
        const content = await response.text();
        if (request === pageRequest) renderPage(page.body, content, name);
    } catch (error) {
        if (request === pageRequest) page.body.textContent = '페이지를 불러오지 못했습니다.';
        console.error('Failed to load ' + pageUrl(name) + ':', error);
    }
}

function openTab() {
    const hash = location.hash;
    const staticTab = hash === '#file' || hash === '#files' ? 'file'
        : hash === '#posts' || hash.startsWith('#posts/') ? 'posts' : null;
    let pageName = null;
    if (!staticTab) {
        if (hash === '#main') pageName = 'main';
        else if (hash.startsWith('#pages/')) {
            try { pageName = decodeURIComponent(hash.slice(7)); } catch {}
        }
        if (!pages.has(pageName)) pageName = pages.has('main') ? 'main' : pages.keys().next().value || null;
    }
    const request = ++pageRequest;
    for (const [name, page] of pages) {
        const active = !staticTab && name === pageName;
        page.panel.hidden = !active;
        page.tab.setAttribute('aria-selected', String(active));
    }
    const activeStatic = staticTab || (pageName ? null : 'file');
    for (const name of ['file', 'posts']) {
        $(name + '-panel').hidden = name !== activeStatic;
        $(name + '-tab').setAttribute('aria-selected', String(name === activeStatic));
    }
    $('copy-status').textContent = '';
    if (pageName) return showPage(pageName, request);
    return activeStatic === 'posts' ? posts.openTab() : filesReady;
}

async function loadPages() {
    try {
        const entries = await getJson('/pages/');
        const names = (await Promise.all(entries.filter(item => item.type === 'directory' &&
            validPath(item.name) && !item.name.includes('/')).map(async item => {
            try {
                const response = await fetch(pageUrl(item.name), { method: 'HEAD', cache: 'no-store' });
                return response.ok ? item.name : null;
            } catch (error) { console.error('Failed to check page ' + item.name + ':', error); return null; }
        }))).filter(Boolean).sort((a, b) => a === 'main' ? -1 : b === 'main' ? 1 : a.localeCompare(b, 'ko'));
        for (const [index, name] of names.entries()) {
            const tab = element('a', name);
            tab.id = 'page-tab-' + index;
            tab.href = '#pages/' + encodeURIComponent(name);
            tab.setAttribute('role', 'tab');
            tab.setAttribute('aria-controls', 'page-panel-' + index);
            $('file-tab').before(tab);
            const panel = element('section', '');
            panel.id = 'page-panel-' + index;
            panel.className = 'panel';
            panel.hidden = true;
            panel.setAttribute('role', 'tabpanel');
            panel.setAttribute('aria-labelledby', tab.id);
            const box = element('fieldset', '');
            box.className = 'page-box';
            box.append(element('legend', name));
            const body = element('article', '');
            body.className = 'post-body';
            box.append(body);
            panel.append(box);
            $('pages-panels').append(panel);
            pages.set(name, { tab, panel, body });
        }
    } catch (error) { console.error('Failed to load pages:', error); }
    window.addEventListener('hashchange', openTab);
    try { await openTab(); }
    finally { document.documentElement.classList.remove('loading'); }
}

loadPages();
