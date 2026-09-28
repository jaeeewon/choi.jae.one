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
            'def prune_empty(items):',
            '    for entry in items[:]:',
            "        if isinstance(entry.get('children'), list):",
            "            prune_empty(entry['children'])",
            "            if not entry['children']: items.remove(entry)",
            'prune_empty(data)',
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

    const hasLink = item => !Array.isArray(item.children) || item.children.some(hasLink);
    const wrapLinks = (items, indices = [], ancestors = []) => items.map((item, index) => ({
        item, indices: [...indices, index], ancestors
    }));
    const source = text => {
        const badge = element('small', text);
        badge.className = 'source';
        return badge;
    };

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

    function renderTree(entries, container, path, prefix, linkNodes, failed = false) {
        const links = linkNodes.filter(node => hasLink(node.item));
        const folders = new Map();
        for (const item of entries) if (item.type === 'directory') {
            folders.set(item.name, { file: item, links: [] });
        }
        for (const node of links) if (Array.isArray(node.item.children)) {
            if (!folders.has(node.item.title)) folders.set(node.item.title, { file: null, links: [] });
            folders.get(node.item.title).links.push(node);
        }
        container.replaceChildren();
        const rendered = new Set();
        function addFolder(name) {
            if (rendered.has(name)) return;
            rendered.add(name);
            const group = folders.get(name);
            const children = element('div', '');
            const details = element('details', '');
            const summary = element('summary', name + '/ ');
            summary.append(source([group.file && 'static', group.links.length && 'link'].filter(Boolean).join(' · ')));
            if (group.file) summary.append(element('small', formatTime(group.file.mtime) +
                (group.file.size === undefined ? '' : ' · ' + formatSize(group.file.size))));
            details.append(summary, children);
            const childLinks = group.links.flatMap(({ item, indices, ancestors }) =>
                wrapLinks(item.children, indices, [...ancestors, item.title]));
            const childPath = group.file ? path + encodeURIComponent(name) + '/' : null;
            details.addEventListener('toggle', () => {
                if (details.open) showTree(childPath, children, prefix + name + '/', childLinks);
            });
            container.append(details);
        }
        for (const item of entries) {
            if (item.type === 'directory') { addFolder(item.name); continue; }
            const relative = prefix + item.name;
            const row = element('div', '');
            row.className = 'entry';
            const link = element('a', item.name);
            link.href = path + encodeURIComponent(item.name);
            link.target = '_blank';
            link.rel = 'noopener noreferrer';
            const button = element('button', selectedPath === relative ? '선택 해제' : '선택');
            button.type = 'button';
            if (selectedPath === relative) selectedButton = button;
            button.addEventListener('click', () => selectFile(relative, button));
            row.append(link, source('static'), element('small', formatTime(item.mtime) +
                (item.size === undefined ? '' : ' · ' + formatSize(item.size))), button);
            container.append(row);
        }
        for (const node of links) {
            const item = node.item;
            if (Array.isArray(item.children)) { addFolder(item.title); continue; }
            const row = element('div', '');
            row.className = 'entry';
            const link = element('a', item.title);
            link.href = item.url;
            link.target = '_blank';
            link.rel = 'noopener noreferrer';
            const selection = { indices: node.indices, ancestors: node.ancestors,
                original: JSON.parse(JSON.stringify(item)) };
            const selected = selectedLink &&
                JSON.stringify(selectedLink.indices) === JSON.stringify(selection.indices);
            const button = element('button', selected ? '선택 해제' : '선택');
            button.type = 'button';
            if (selected) selectedLinkButton = button;
            button.addEventListener('click', () => selectLink(selection, button));
            row.append(link, source('link'), button);
            container.append(row);
        }
        if (!entries.length && !links.length && !failed) container.textContent = '비어 있음';
    }

    async function showTree(path, container, prefix, links) {
        let entries = [], failed = false;
        try { if (path) entries = await getJson(path); }
        catch (error) {
            failed = true;
            console.error('Failed to load ' + path + ':', error);
        }
        renderTree(entries, container, path, prefix, links, failed);
        if (failed) container.append(element('small', '파일 목록을 불러오지 못했습니다.'));
    }

    async function showFiles() {
        const [files, links] = await Promise.allSettled([getJson('/files/'), getJson('/links.json')]);
        const container = $('file-tree');
        renderTree(files.status === 'fulfilled' ? files.value : [], container, '/files/', '',
            links.status === 'fulfilled' ? wrapLinks(links.value) : [],
            files.status === 'rejected' || links.status === 'rejected');
        if (files.status === 'rejected') {
            container.append(element('small', '파일 목록을 불러오지 못했습니다.'));
            console.error('Failed to load files:', files.reason);
        }
        if (links.status === 'rejected') {
            container.append(element('small', '링크 목록을 불러오지 못했습니다.'));
            console.error('Failed to load links:', links.reason);
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
    showFiles();
    return updateCommands;
}
