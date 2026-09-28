const siteRoot = '/web-static/choi-jae-one/';
export const fileRoot = siteRoot + 'files/';
export const postRoot = siteRoot + 'posts/';
export const linkPath = siteRoot + 'web/links.json';
export const $ = id => document.getElementById(id);
export const quote = value => "'" + value.replace(/'/g, "'\\''") + "'";
export const validPath = path => !!path.trim() && !path.startsWith('/') &&
    path.split('/').every(part => part && part !== '.' && part !== '..' && !/[\\\r\n]/.test(part));
export const safeSegment = value => validPath(value) && !value.includes('/') && !/["`$%!]/.test(value);

export function base64Utf8(value) {
    const bytes = new TextEncoder().encode(value);
    let encoded = '';
    for (let i = 0; i < bytes.length; i += 0x6000) {
        encoded += btoa(String.fromCharCode(...bytes.subarray(i, i + 0x6000)));
    }
    return encoded;
}

export const remotePython = (account, script) =>
    'ssh ' + account + ' "echo ' + base64Utf8(script) + ' | base64 -d | python3"';

export function setCommand(action, text) {
    $(action + '-command').textContent = text || '값을 입력하세요.';
    document.querySelector('[data-copy="' + action + '"]').disabled = !text;
}

export function getAccount() {
    const user = $('scp-user').value.trim();
    const host = $('scp-host').value.trim();
    return /^[\w][\w.+-]*$/.test(user) && /^[\w][\w.:-]*$/.test(host) ? user + '@' + host : '';
}

export function syncAccounts(onInput) {
    for (const [ids, key] of [[['scp-user', 'posts-user'], 'scp-user'],
        [['scp-host', 'posts-host'], 'scp-host']]) {
        const inputs = ids.map($);
        let saved = '';
        try { saved = localStorage.getItem(key) || ''; } catch (error) { console.error(error); }
        for (const input of inputs) {
            input.value = saved;
            input.addEventListener('input', () => {
                for (const other of inputs) if (other !== input) other.value = input.value;
                onInput();
            });
            input.addEventListener('change', () => {
                try { localStorage.setItem(key, input.value.trim()); } catch (error) { console.error(error); }
            });
        }
    }
}

export async function getJson(path) {
    const response = await fetch(path, { cache: 'no-store' });
    if (!response.ok) throw new Error('HTTP ' + response.status);
    return response.json();
}

export const element = (tag, text) => {
    const node = document.createElement(tag);
    node.textContent = text;
    return node;
};

export function formatTime(value) {
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return value;
    const two = n => String(n).padStart(2, '0');
    return [two(date.getFullYear() % 100), two(date.getMonth() + 1), two(date.getDate())].join(':') +
        ' ' + [two(date.getHours()), two(date.getMinutes()), two(date.getSeconds())].join(':');
}

export function formatSize(bytes) {
    const units = ['B', 'KB', 'MB', 'GB', 'TB'];
    let value = bytes, unit = 0;
    while (value >= 1024 && unit < units.length - 1) { value /= 1024; unit++; }
    return (unit ? value.toFixed(value < 10 ? 1 : 0) : value) + ' ' + units[unit];
}
