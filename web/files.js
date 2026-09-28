import { fileRoot, linkPath, $, quote, validPath, safeSegment, remotePython, setCommand, getAccount,
    getJson, element, formatTime, formatSize } from './shared.js';

export function initFiles() {
    const fileInput = $('file-name');
    const uploadNameInput = $('upload-name');
    let uploadNameAuto = true;
    const folderInput = $('folder-name');
    const newNameInput = $('new-name');
    const linkFolderInput = $('link-folder');
    const linkTitleInput = $('link-title');
    const linkUrlInput = $('link-url');
    let selectedPath = null;
    let selectedButton = null;
    let selectedLink = null, selectedLinkButton = null;

    function linkCommand(account, entry) {
        const script = [
            'import json',
            'from pathlib import Path',
            'path = Path(' + JSON.stringify(linkPath) + ')',
            'data = json.loads(path.read_text())',
            'entry = json.loads(' + JSON.stringify(JSON.stringify(entry)) + ')',
            'items = data',
            "for title in filter(None, entry['folder'].split('/')):",
            "    found = next((x for x in items if x.get('title') == title and isinstance(x.get('children'), list)), None)",
            '    if found is None:',
            "        found = {'title': title, 'children': []}",
            '        items.append(found)',
            "    items = found['children']",
            "items.append({'title': entry['title'], 'url': entry['url']})",
            "path.write_text(json.dumps(data, ensure_ascii=False, indent=2) + '\\n')"
        ].join('\n');
        return remotePython(account, script);
    }

    function linkMutationCommand(account, action, selection, change) {
        const script = [
            'import json',
            'from pathlib import Path',
            'path = Path(' + JSON.stringify(linkPath) + ')',
            'data = json.loads(path.read_text())',
            'selection = json.loads(' + JSON.stringify(JSON.stringify(selection)) + ')',
            'items = data',
            "for index, title in zip(selection['indices'][:-1], selection['ancestors']):",
            '    parent = items[index]',
            "    if parent.get('title') != title or not isinstance(parent.get('children'), list): raise ValueError('Link folder changed')",
            "    items = parent['children']",
            "index = selection['indices'][-1]",
            'item = items[index]',
            "if item != selection['original']: raise ValueError('Link changed; refresh the page')",
            ...(action === 'delete' ? ['del items[index]'] : [
                'change = json.loads(' + JSON.stringify(JSON.stringify(change)) + ')',
                "item.update({'title': change['title'], 'url': change['url']})",
                "if change['folder'] != '/'.join(selection['ancestors']):",
                '    del items[index]',
                '    items = data',
                "    for title in filter(None, change['folder'].split('/')):",
                "        found = next((x for x in items if x.get('title') == title and isinstance(x.get('children'), list)), None)",
                '        if found is None:',
                "            found = {'title': title, 'children': []}",
                '            items.append(found)',
                "        items = found['children']",
                '    items.append(item)'
            ]),
            "path.write_text(json.dumps(data, ensure_ascii=False, indent=2) + '\\n')"
        ].join('\n');
        return remotePython(account, script);
    }

    function updateCommands() {
        const account = getAccount();
        const file = fileInput.value;
        const name = uploadNameInput.value.trim();
        const folder = folderInput.value;
        const remoteDir = fileRoot + (folder ? folder + '/' : '');
        const validFolder = !folder || folder.split('/').every(safeSegment);
        const canUpload = account && file.trim() && !/["\r\n]/.test(file) &&
            safeSegment(name) && validFolder;
        $('mkdir-command').parentElement.hidden = !folder;
        setCommand('mkdir', account && folder && validFolder
            ? 'ssh ' + account + ' "mkdir -p -- ' + quote(remoteDir) + '"' : '');
        setCommand('upload', canUpload
            ? 'scp "' + file + '" "' + account + ':' + remoteDir + name + '"' : '');

        const oldPath = fileRoot + selectedPath;
        const newName = newNameInput.value;
        const parent = selectedPath ? selectedPath.slice(0, selectedPath.lastIndexOf('/') + 1) : '';
        setCommand('delete', selectedPath && account
            ? 'ssh ' + account + ' ' + quote('rm -- ' + quote(oldPath)) : '');
        setCommand('rename', selectedPath && account && validPath(newName) && !newName.includes('/')
            ? 'ssh ' + account + ' ' + quote('mv -- ' + quote(oldPath) + ' ' + quote(fileRoot + parent + newName))
            : '');

        const title = linkTitleInput.value.trim();
        const url = linkUrlInput.value.trim();
        const folders = linkFolderInput.value
            ? linkFolderInput.value.split('/').map(part => part.trim()) : [];
        let validUrl = false;
        try { validUrl = ['http:', 'https:'].includes(new URL(url).protocol); } catch {}
        setCommand('link', account && title && validUrl && folders.every(Boolean)
            ? linkCommand(account, { folder: folders.join('/'), title, url }) : '');

        setCommand('link-delete', selectedLink && account
            ? linkMutationCommand(account, 'delete', selectedLink) : '');
        const editTitle = $('selected-link-title').value.trim();
        const editUrl = $('selected-link-url').value.trim();
        const editFolders = $('selected-link-folder').value
            ? $('selected-link-folder').value.split('/').map(part => part.trim()) : [];
        let validEditUrl = false;
        try { validEditUrl = ['http:', 'https:'].includes(new URL(editUrl).protocol); } catch {}
        const change = { folder: editFolders.join('/'), title: editTitle, url: editUrl };
        const changed = selectedLink && (change.folder !== selectedLink.ancestors.join('/') ||
            change.title !== selectedLink.original.title || change.url !== selectedLink.original.url);
        setCommand('link-edit', account && changed && editTitle && validEditUrl && editFolders.every(Boolean)
            ? linkMutationCommand(account, 'edit', selectedLink, change) : '');
    }

    function setModifyOpen(open) {
        $('modify-box').hidden = !open;
        $('toggle-modify').setAttribute('aria-expanded', String(open));
        $('toggle-modify').textContent = open ? 'modify 닫기' : 'modify 열기';
    }

    function selectFile(path, button) {
        const deselect = selectedPath === path;
        if (selectedButton) selectedButton.textContent = '선택';
        selectedPath = deselect ? null : path;
        selectedButton = deselect ? null : button;
        if (selectedButton) { selectedButton.textContent = '선택 해제'; setModifyOpen(true); }
        $('selected-name').textContent = selectedPath || '';
        $('selected-panel').hidden = !selectedPath;
        newNameInput.value = '';
        updateCommands();
    }

    async function showFiles(path, container, prefix = '') {
        try {
            const entries = await getJson(path);
            container.replaceChildren();
            for (const item of entries) {
                const url = path + encodeURIComponent(item.name);
                const relative = prefix + item.name;
                const meta = element('small', formatTime(item.mtime) +
                    (item.size === undefined ? '' : ' · ' + formatSize(item.size)));
                if (item.type === 'directory') {
                    const folder = element('details', '');
                    const summary = element('summary', item.name + '/ ');
                    const children = element('div', '');
                    summary.append(meta);
                    folder.append(summary, children);
                    folder.addEventListener('toggle', () => {
                        if (folder.open) showFiles(url + '/', children, relative + '/');
                    });
                    container.append(folder);
                } else {
                    const row = element('div', '');
                    row.className = 'entry';
                    const link = element('a', item.name);
                    link.href = url;
                    link.target = '_blank';
                    link.rel = 'noopener noreferrer';
                    const button = element('button', selectedPath === relative ? '선택 해제' : '선택');
                    button.type = 'button';
                    if (selectedPath === relative) selectedButton = button;
                    button.addEventListener('click', () => selectFile(relative, button));
                    row.append(link, meta, button);
                    container.append(row);
                }
            }
            if (!entries.length) container.textContent = '비어 있음';
        } catch (error) {
            container.textContent = '파일 목록을 불러오지 못했습니다.';
            console.error('Failed to load ' + path + ':', error);
        }
    }

    function selectLink(selection, button) {
        const deselect = selectedLink &&
            JSON.stringify(selectedLink.indices) === JSON.stringify(selection.indices);
        if (selectedLinkButton) selectedLinkButton.textContent = '선택';
        selectedLink = deselect ? null : selection;
        selectedLinkButton = deselect ? null : button;
        if (selectedLinkButton) { selectedLinkButton.textContent = '선택 해제'; setModifyOpen(true); }
        $('selected-link-panel').hidden = !selectedLink;
        $('selected-link-name').textContent = selectedLink
            ? [...selection.ancestors, selection.original.title].join('/') : '';
        $('selected-link-folder').value = selectedLink ? selection.ancestors.join('/') : '';
        $('selected-link-title').value = selectedLink ? selection.original.title : '';
        $('selected-link-url').value = selectedLink ? selection.original.url : '';
        updateCommands();
    }

    function renderLinks(items, container, indices = [], ancestors = []) {
        for (const [index, item] of items.entries()) {
            if (Array.isArray(item.children)) {
                const folder = element('details', '');
                const children = element('div', '');
                folder.append(element('summary', item.title + '/'), children);
                renderLinks(item.children, children, [...indices, index], [...ancestors, item.title]);
                container.append(folder);
            } else {
                const row = element('div', '');
                row.className = 'entry';
                const link = element('a', item.title);
                link.href = item.url;
                link.target = '_blank';
                link.rel = 'noopener noreferrer';
                const selection = { indices: [...indices, index], ancestors,
                    original: JSON.parse(JSON.stringify(item)) };
                const button = element('button', '선택');
                button.type = 'button';
                button.addEventListener('click', () => selectLink(selection, button));
                row.append(link, button);
                container.append(row);
            }
        }
    }

    async function showLinks() {
        const container = $('links');
        try {
            container.replaceChildren();
            renderLinks(await getJson('/links.json'), container);
        } catch (error) {
            container.textContent = '링크 목록을 불러오지 못했습니다.';
            console.error('Failed to load links:', error);
        }
    }

    for (const input of [folderInput, newNameInput, linkFolderInput, linkTitleInput, linkUrlInput,
        $('selected-link-folder'), $('selected-link-title'), $('selected-link-url')]) {
        input.addEventListener('input', updateCommands);
    }
    fileInput.addEventListener('input', () => {
        if (uploadNameAuto) uploadNameInput.value = fileInput.value.split(/[\\/]/).pop().trim();
        updateCommands();
    });
    uploadNameInput.addEventListener('input', () => {
        uploadNameAuto = !uploadNameInput.value.trim();
        updateCommands();
    });
    uploadNameInput.addEventListener('change', () => {
        if (!uploadNameInput.value.trim()) {
            uploadNameInput.value = fileInput.value.split(/[\\/]/).pop().trim();
            uploadNameAuto = true;
            updateCommands();
        }
    });
    $('toggle-modify').addEventListener('click', () => setModifyOpen($('modify-box').hidden));
    $('clear-selection').addEventListener('click', () => selectFile(selectedPath, selectedButton));
    $('clear-link-selection').addEventListener('click', () => {
        if (selectedLink) selectLink(selectedLink, selectedLinkButton);
    });
    showFiles('/files/', $('files'));
    showLinks();
    return updateCommands;
}
