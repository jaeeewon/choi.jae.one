import { $, syncAccounts } from './shared.js';
import { initFiles } from './files.js';
import { initPosts } from './posts.js';

const updateFiles = initFiles();
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

function openTab() {
    const active = location.hash === '#posts' || location.hash.startsWith('#posts/') ? 'posts' : 'file';
    for (const name of ['file', 'posts']) {
        $(name + '-panel').hidden = name !== active;
        $(name + '-tab').setAttribute('aria-selected', String(name === active));
    }
    $('copy-status').textContent = '';
    if (active === 'posts') posts.openTab();
}
window.addEventListener('hashchange', openTab);
openTab();
