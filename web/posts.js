import { postRoot, $, safeSegment, base64Utf8, remotePython, setCommand,
    getAccount, getJson, element, formatTime, formatSize } from './shared.js';

export function initPosts() {
    const folderInput = $('post-folder');
    const postHref = folder => '#posts/' + encodeURIComponent(folder);
    const postUrl = folder => '/posts/' + encodeURIComponent(folder) + '/post.md';
    const imageUrl = (folder, name) => '/posts/' + encodeURIComponent(folder) + '/' + encodeURIComponent(name);
    const validImage = name => safeSegment(name) && name.toLowerCase() !== 'post.md';
    let editingFolder = null, originalContent = '', createdContent = null;
    let folderState = 'invalid', folderRequest = 0, folderTimer = null, checkedFolder = '';
    let builtKey = null;
    let images = [], editRequest = 0, openFolder = null;

    function rebaseImages(container, folder) {
        if (!safeSegment(folder)) return;
        const base = new URL(postUrl(folder), location.origin);
        for (const image of container.querySelectorAll('img[src]')) {
            const src = image.getAttribute('src');
            if (!src) continue;
            const resolved = new URL(src, base);
            let name = '';
            try { name = decodeURIComponent(resolved.pathname.split('/').pop()); } catch {}
            const selected = folder === editingFolder && images.find(item => item.verified && item.insertedName === name);
            image.src = selected && resolved.origin === location.origin
                ? imageUrl(folder, name) + '?v=' + selected.version : resolved.href;
        }
    }

    let markdownEditor = null;
    function renderPreview(content) {
        const preview = element('div', '');
        preview.innerHTML = markdownEditor.markdown(content);
        rebaseImages(preview, editingFolder || folderInput.value.trim());
        return preview.innerHTML;
    }
    if (window.EasyMDE && window.DOMPurify) {
        markdownEditor = new EasyMDE({
            element: $('post-source'),
            autoDownloadFontAwesome: false,
            spellChecker: false,
            toolbar: [
                { name: 'bold', action: EasyMDE.toggleBold, text: 'B', title: '굵게' },
                { name: 'italic', action: EasyMDE.toggleItalic, text: 'I', title: '기울임' },
                { name: 'heading', action: EasyMDE.toggleHeadingSmaller, text: 'H', title: '제목' },
                { name: 'link', action: EasyMDE.drawLink, text: '링크', title: '링크' },
                { name: 'code', action: EasyMDE.toggleCodeBlock, text: '</>', title: '코드' },
                '|',
                { name: 'post-preview-toggle', action: () => setPreview(!markdownEditor.isPreviewActive()),
                    className: 'post-preview-toggle', text: '미리보기', title: '미리보기' }
            ],
            renderingConfig: { sanitizerFunction: html => DOMPurify.sanitize(html) },
            previewRender: content => markdownEditor ? renderPreview(content) : DOMPurify.sanitize(content)
        });
    }
    const postSource = () => markdownEditor ? markdownEditor.value() : $('post-source').value;

    function refreshPreview() {
        if (!markdownEditor || !markdownEditor.isPreviewActive()) return;
        const preview = $('post-upload-box').querySelector('.editor-preview-full');
        if (preview) preview.innerHTML = renderPreview(postSource());
    }
    function setPreview(preview) {
        if (!markdownEditor) return;
        if (markdownEditor.isPreviewActive() !== preview) EasyMDE.togglePreview(markdownEditor);
        const toggle = $('post-upload-box').querySelector('.post-preview-toggle');
        if (toggle) {
            toggle.textContent = preview ? '수정으로 돌아가기' : '미리보기';
            toggle.title = toggle.textContent;
            toggle.setAttribute('aria-pressed', String(preview));
        }
        if (!preview) requestAnimationFrame(() => markdownEditor.codemirror.refresh());
    }

    const duplicateImage = item => validImage(item.name) &&
        images.some(other => other !== item && other.name === item.name);
    function imageCommand(item) {
        const account = getAccount();
        return account && editingFolder && validImage(item.name) && !duplicateImage(item) && item.path.trim() &&
            !/["\r\n]/.test(item.path)
            ? 'scp "' + item.path + '" "' + account + ':' + postRoot + editingFolder + '/' + item.name + '"'
            : '';
    }
    function updateImageRow(item) {
        const command = imageCommand(item);
        item.code.textContent = command || '글 생성 확인과 경로 입력이 필요합니다.';
        item.copy.disabled = !command;
        item.status.textContent = duplicateImage(item) ? '이미지 이름이 중복됩니다.' :
            item.checking ? '서버 파일 확인 중...' : item.verified
            ? '서버에서 이미지 확인됨' : item.message || 'SCP 실행 후 업로드 확인';
    }
    function renamePostCommand(account, oldFolder, newFolder) {
        const script = [
            'from pathlib import Path',
            'import os',
            'old = Path(' + JSON.stringify(postRoot + oldFolder) + ')',
            'new = Path(' + JSON.stringify(postRoot + newFolder) + ')',
            "if not (old / 'post.md').is_file(): raise FileNotFoundError(old / 'post.md')",
            'if os.path.lexists(new): raise FileExistsError(new)',
            'old.rename(new)'
        ].join('\n');
        return remotePython(account, script);
    }
    const commandKey = () => JSON.stringify([getAccount(), folderInput.value.trim(), editingFolder, postSource()]);
    function updateState() {
        const folder = folderInput.value.trim();
        const changed = editingFolder ? postSource() !== originalContent : !!postSource().trim();
        const ready = getAccount() && safeSegment(folder) && changed &&
            (editingFolder ? folder === editingFolder : folderState === 'free');
        $('build-post').disabled = !ready;
        const renaming = !!editingFolder && folder !== editingFolder;
        const canRename = renaming && folderState === 'free' && safeSegment(folder) && getAccount();
        $('post-rename-panel').hidden = !renaming;
        setCommand('post-rename', canRename ? renamePostCommand(getAccount(), editingFolder, folder) : '');
        $('confirm-post-rename').disabled = !canRename;
        $('verify-images').disabled = !editingFolder || !images.some(item => !item.verified);
        const canInsert = images.some(item => item.verified && validImage(item.name) && !duplicateImage(item));
        const width = Number($('image-width').value);
        $('insert-markdown').disabled = !canInsert;
        $('insert-html').disabled = !canInsert || !Number.isInteger(width) || width < 1 || width > 10000;
        $('post-build-status').textContent = createdContent && !editingFolder
            ? '명령 실행 후 글 생성 확인을 누르세요.'
            : renaming ? '제목 변경 확인 후 본문을 저장하세요.'
            : editingFolder && !changed ? '글 본문 변경 사항이 없습니다.' : '';
        $('image-status').textContent = images.length ? images.length + '개 선택 · ' +
            images.filter(item => item.verified).length + '개 서버 확인' : '';
        for (const item of images) updateImageRow(item);
        if (builtKey && builtKey !== commandKey()) { builtKey = null; setCommand('post', ''); }
    }
    function showFolderState() {
        $('post-folder-status').textContent = editingFolder && folderInput.value.trim() === editingFolder
            ? '기존 글 수정 중' : ({
            invalid: '사용할 수 있는 제목을 입력하세요.', checking: '같은 제목의 폴더가 있는지 확인 중...',
            free: '새 제목으로 사용할 수 있습니다.', exists: '이미 같은 제목의 폴더가 있습니다.',
            error: '폴더 확인에 실패했습니다. 다시 입력해 확인하세요.'
        })[folderState];
    }
    function checkFolder(delay = 300) {
        const folder = folderInput.value.trim();
        if (editingFolder && folderInput.readOnly) {
            ++folderRequest; clearTimeout(folderTimer);
            folderState = 'editing'; checkedFolder = '';
            $('post-rename-status').textContent = '';
            showFolderState(); updateState();
            return;
        }
        if (delay === 0 && folder === checkedFolder &&
            ['free', 'exists'].includes(folderState)) return;
        clearTimeout(folderTimer);
        const request = ++folderRequest;
        checkedFolder = folder;
        createdContent = null;
        $('confirm-post').hidden = true;
        if (editingFolder && folder === editingFolder) {
            folderState = 'editing'; showFolderState(); updateState(); return;
        }
        if (!safeSegment(folder)) { folderState = 'invalid'; showFolderState(); updateState(); return; }
        folderState = 'checking';
        showFolderState(); updateState();
        folderTimer = setTimeout(async () => {
            try {
                let response = await fetch('/posts/' + encodeURIComponent(folder) + '/',
                    { method: 'HEAD', cache: 'no-store' });
                if (response.status === 405) response = await fetch('/posts/' + encodeURIComponent(folder) + '/',
                    { cache: 'no-store' });
                if (request !== folderRequest) return;
                folderState = response.status === 404 ? 'free' : response.ok ? 'exists' : 'error';
            } catch (error) {
                if (request !== folderRequest) return;
                folderState = 'error';
                console.error('Failed to check post folder:', error);
            }
            showFolderState(); updateState();
        }, delay);
    }

    function clearImages() {
        for (const item of images) item.checkRequest++;
        images = [];
        $('image-list').replaceChildren();
    }
    function addImage() {
        const item = { name: '', path: '', autoName: true, verified: false,
            checking: false, message: '', insertedName: null, checkRequest: 0, version: 0 };
        images.push(item);
        const row = element('div', '');
        row.className = 'image-row';
        const preview = document.createElement('img');
        preview.alt = '확인된 이미지'; preview.hidden = true; item.preview = preview;
        const pathLabel = element('label', 'local path');
        const pathInput = document.createElement('input');
        pathInput.type = 'text'; pathInput.autocomplete = 'off';
        pathLabel.append(pathInput);
        const nameLabel = element('label', 'image name');
        const nameInput = document.createElement('input');
        nameInput.type = 'text'; nameInput.autocomplete = 'off';
        nameLabel.append(nameInput);
        const changed = () => {
            item.verified = false; item.checking = false; item.checkRequest++;
            preview.hidden = true; preview.removeAttribute('src');
            item.message = validImage(item.name) ? 'SCP 실행 후 업로드 확인' : '사용할 수 없는 이미지 이름';
            updateImageRow(item); updateState();
        };
        pathInput.addEventListener('input', () => {
            item.path = pathInput.value;
            if (item.autoName) {
                item.name = item.path.split(/[\\/]/).pop().trim();
                nameInput.value = item.name;
            }
            changed();
        });
        nameInput.addEventListener('input', () => {
            item.name = nameInput.value.trim();
            item.autoName = !item.name;
            changed();
        });
        nameInput.addEventListener('change', () => {
            if (!item.name) {
                item.name = item.path.split(/[\\/]/).pop().trim();
                nameInput.value = item.name; item.autoName = true; changed();
            }
        });
        const status = element('small', ''); item.status = status;
        const code = element('code', ''); item.code = code;
        const copy = element('button', 'copy');
        copy.type = 'button'; item.copy = copy;
        copy.addEventListener('click', async () => {
            try {
                await navigator.clipboard.writeText(code.textContent);
                item.verified = false; item.preview.hidden = true; updateState();
                $('copy-status').textContent = 'image SCP 복사됨';
            }
            catch (error) { $('copy-status').textContent = '복사 실패'; console.error(error); }
        });
        const remove = element('button', '행 삭제');
        remove.type = 'button';
        remove.addEventListener('click', () => {
            item.checkRequest++; images = images.filter(entry => entry !== item);
            row.remove(); refreshPreview(); updateState();
        });
        const command = element('div', '');
        command.className = 'command'; command.append(code, copy);
        row.append(preview, pathLabel, nameLabel, status, remove, command);
        $('image-list').append(row);
        updateImageRow(item); updateState();
        pathInput.focus();
    }

    const escapeHtml = value => value.replace(/[&<>"']/g, character => ({
        '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
    })[character]);
    function replaceReference(oldName, newName) {
        const oldPath = './' + encodeURIComponent(oldName);
        const newPath = './' + encodeURIComponent(newName);
        const pairs = [['](' + oldPath + ')', '](' + newPath + ')'],
            ['src="' + oldPath + '"', 'src="' + newPath + '"']];
        if (markdownEditor) {
            const cm = markdownEditor.codemirror;
            for (const [oldText, newText] of pairs) {
                let content = cm.getValue(), index = content.lastIndexOf(oldText);
                while (index !== -1) {
                    cm.replaceRange(newText, cm.posFromIndex(index), cm.posFromIndex(index + oldText.length));
                    content = cm.getValue(); index = content.lastIndexOf(oldText, index - 1);
                }
            }
        } else {
            for (const [oldText, newText] of pairs) {
                $('post-source').value = $('post-source').value.replaceAll(oldText, newText);
            }
            updateState();
        }
    }
    function insertReferences(format) {
        const items = images.filter(item => item.verified && validImage(item.name) && !duplicateImage(item));
        if (!items.length) return;
        setPreview(false);
        const width = Number($('image-width').value);
        if (format === 'html' && (!Number.isInteger(width) || width < 1 || width > 10000)) return;
        const markup = items.map(item => format === 'html'
            ? '<img src="./' + encodeURIComponent(item.name) + '" alt="' + escapeHtml(item.name) +
                '" width="' + width + '">'
            : '![' + item.name.replace(/[\\\]]/g, '\\$&') + '](./' + encodeURIComponent(item.name) + ')'
        ).join(format === 'html' ? '\n\n' : '\n') + (format === 'html' ? '\n\n' : '\n');
        if (markdownEditor) {
            markdownEditor.codemirror.replaceSelection(markup);
            markdownEditor.codemirror.focus();
        } else {
            const input = $('post-source');
            input.setRangeText(markup, input.selectionStart, input.selectionEnd, 'end');
            input.dispatchEvent(new Event('input'));
        }
        for (const item of items) item.insertedName = item.name;
    }
    async function verifyImages() {
        const folder = editingFolder;
        if (!folder) return;
        $('verify-images').disabled = true;
        const newlyVerified = [];
        for (const item of images) {
            if (item.verified) continue;
            if (!validImage(item.name) || duplicateImage(item)) {
                item.message = duplicateImage(item) ? '이미지 이름이 중복됩니다.' : '사용할 수 없는 이미지 이름';
                updateImageRow(item); continue;
            }
            const request = ++item.checkRequest, name = item.name;
            item.checking = true; updateImageRow(item);
            try {
                let response = await fetch(imageUrl(folder, name), { method: 'HEAD', cache: 'no-store' });
                if (response.status === 405) response = await fetch(imageUrl(folder, name), { cache: 'no-store' });
                if (request !== item.checkRequest || !images.includes(item)) continue;
                const exists = response.ok && (response.headers.get('Content-Type') || '').startsWith('image/');
                item.verified = exists;
                item.message = exists ? '' : '서버에서 이미지를 찾지 못했습니다. SCP 실행 후 다시 확인하세요.';
                if (exists) {
                    item.version = Date.now();
                    item.preview.src = imageUrl(folder, name) + '?v=' + item.version;
                    item.preview.hidden = false;
                    newlyVerified.push(item);
                }
            } catch (error) {
                if (request === item.checkRequest) item.message = '확인 실패 · 다시 시도하세요.';
                console.error('Failed to verify image:', error);
            } finally {
                if (request === item.checkRequest) { item.checking = false; updateImageRow(item); }
            }
        }
        for (const item of newlyVerified) {
            if (item.insertedName && item.insertedName !== item.name) {
                replaceReference(item.insertedName, item.name);
                item.insertedName = item.name;
            }
        }
        refreshPreview(); updateState();
    }

    function openEditor(folder, content) {
        clearImages();
        editingFolder = folder;
        originalContent = content;
        createdContent = null;
        ++folderRequest; clearTimeout(folderTimer);
        setPreview(false);
        folderInput.value = folder || '';
        folderInput.readOnly = !!folder;
        $('unlock-post-title').hidden = !folder;
        $('unlock-post-title').textContent = '제목 변경';
        $('close-post-editor').hidden = false;
        $('post-rename-status').textContent = '';
        checkedFolder = '';
        $('post-editor-title').textContent = folder ? 'post editor · 수정: ' + folder : 'post editor · 새 글';
        $('reset-post').hidden = !folder;
        $('confirm-post').hidden = true;
        $('post-upload-box').hidden = false;
        if (markdownEditor) {
            markdownEditor.value(content);
            requestAnimationFrame(() => markdownEditor.codemirror.refresh());
        } else $('post-source').value = content;
        builtKey = null; setCommand('post', '');
        if (folder) { folderState = 'editing'; showFolderState(); updateState(); }
        else checkFolder(0);
        $('post-upload-box').scrollIntoView({ behavior: 'smooth' });
        if (folder) markdownEditor ? markdownEditor.codemirror.focus() : $('post-source').focus();
        else folderInput.focus();
    }
    async function editPost(folder) {
        const request = ++editRequest;
        try {
            const response = await fetch(postUrl(folder), { cache: 'no-store' });
            if (!response.ok) throw new Error('HTTP ' + response.status);
            const content = await response.text();
            if (request === editRequest) openEditor(folder, content);
        } catch (error) {
            if (request === editRequest) $('copy-status').textContent = '글을 불러오지 못했습니다.';
            console.error('Failed to edit ' + folder + ':', error);
        }
    }
    function buildPost() {
        if ($('build-post').disabled) return;
        const account = getAccount(), folder = folderInput.value.trim(), content = postSource();
        const path = postRoot + folder;
        const script = [
            'from pathlib import Path', 'from base64 import b64decode',
            'folder = Path(' + JSON.stringify(path) + ')',
            editingFolder
                ? "path = folder / 'post.md'\nif not path.is_file(): raise FileNotFoundError(path)\npath.write_bytes(b64decode(" + JSON.stringify(base64Utf8(content)) + '))'
                : "folder.mkdir()\n(folder / 'post.md').write_bytes(b64decode(" + JSON.stringify(base64Utf8(content)) + '))'
        ].join('\n');
        setCommand('post', remotePython(account, script));
        builtKey = commandKey();
        if (!editingFolder) {
            createdContent = { folder, content };
            $('confirm-post').hidden = false;
            $('post-build-status').textContent = '명령 실행 후 글 생성 확인을 누르세요.';
        }
    }
    async function confirmPost() {
        if (!createdContent || createdContent.folder !== folderInput.value.trim()) return;
        try {
            const response = await fetch(postUrl(createdContent.folder), { cache: 'no-store' });
            if (!response.ok) throw new Error('HTTP ' + response.status);
            const content = await response.text();
            if (content !== createdContent.content) {
                $('post-build-status').textContent = '서버 글 내용이 생성 명령과 다릅니다.';
                return;
            }
            editingFolder = createdContent.folder;
            originalContent = content;
            createdContent = null;
            ++folderRequest; clearTimeout(folderTimer);
            folderInput.readOnly = true;
            $('unlock-post-title').hidden = false;
            $('unlock-post-title').textContent = '제목 변경';
            $('post-editor-title').textContent = 'post editor · 수정: ' + editingFolder;
            $('reset-post').hidden = false;
            $('confirm-post').hidden = true;
            folderState = 'editing';
            builtKey = null; showFolderState(); setCommand('post', ''); updateState();
        } catch (error) {
            $('post-build-status').textContent = '글을 확인하지 못했습니다. 명령 실행 후 다시 시도하세요.';
        }
    }

    async function confirmRename() {
        if ($('confirm-post-rename').disabled) return;
        const oldFolder = editingFolder, newFolder = folderInput.value.trim(), request = editRequest;
        $('post-rename-status').textContent = '서버 폴더를 확인하는 중...';
        try {
            let [newPost, oldFolderResponse] = await Promise.all([
                fetch(postUrl(newFolder), { cache: 'no-store' }),
                fetch('/posts/' + encodeURIComponent(oldFolder) + '/', { method: 'HEAD', cache: 'no-store' })
            ]);
            if (oldFolderResponse.status === 405) oldFolderResponse = await fetch(
                '/posts/' + encodeURIComponent(oldFolder) + '/', { cache: 'no-store' });
            if (request !== editRequest || editingFolder !== oldFolder ||
                folderInput.value.trim() !== newFolder) return;
            if (!newPost.ok || oldFolderResponse.status !== 404) {
                $('post-rename-status').textContent = '폴더 변경이 확인되지 않았습니다. 명령 실행 후 다시 확인하세요.';
                return;
            }
            const newContent = await newPost.text();
            if (request !== editRequest || editingFolder !== oldFolder ||
                folderInput.value.trim() !== newFolder) return;
            originalContent = newContent;
            editingFolder = newFolder;
            folderInput.readOnly = true;
            $('unlock-post-title').textContent = '제목 변경';
            $('post-editor-title').textContent = 'post editor · 수정: ' + newFolder;
            $('post-rename-status').textContent = '';
            folderState = 'editing'; checkedFolder = '';
            for (const item of images) {
                item.verified = false; item.preview.hidden = true;
                item.preview.removeAttribute('src');
            }
            builtKey = null; setCommand('post', '');
            showFolderState(); updateState(); refreshPreview(); showPosts();
            if (location.hash === postHref(oldFolder)) location.hash = postHref(newFolder);
        } catch (error) {
            $('post-rename-status').textContent = '폴더 확인에 실패했습니다. 다시 시도하세요.';
            console.error('Failed to confirm post rename:', error);
        }
    }

    async function showPost(folder) {
        const box = $('post-view-box');
        const body = $('post-body');
        box.hidden = false;
        $('post-view-title').textContent = folder;
        body.textContent = '불러오는 중...';
        openFolder = folder;
        try {
            const response = await fetch(postUrl(folder), { cache: 'no-store' });
            if (!response.ok) throw new Error('HTTP ' + response.status);
            const content = await response.text();
            if (openFolder !== folder) return;
            if (!markdownEditor) { body.textContent = content; return; }
            body.innerHTML = markdownEditor.markdown(content);
            rebaseImages(body, folder);
            const base = new URL(postUrl(folder), location.origin);
            for (const link of body.querySelectorAll('a[href]')) {
                const raw = link.getAttribute('href');
                if (raw.startsWith('#')) {
                    link.addEventListener('click', event => {
                        let id = raw.slice(1);
                        try { id = decodeURIComponent(id); } catch {}
                        const heading = document.getElementById(id);
                        if (heading && body.contains(heading)) {
                            event.preventDefault();
                            heading.scrollIntoView();
                        }
                    });
                    continue;
                }
                const resolved = new URL(raw, base);
                const match = resolved.origin === location.origin &&
                    /^\/posts\/([^/]+)\/post\.md$/i.exec(resolved.pathname);
                link.href = match ? postHref(decodeURIComponent(match[1])) : resolved.href;
            }
        } catch (error) {
            if (openFolder === folder) body.textContent = '글을 불러오지 못했습니다.';
            console.error('Failed to load post ' + folder + ':', error);
        }
    }

    async function showPosts() {
        const container = $('posts-list');
        try {
            const entries = await getJson('/posts/');
            const posts = await Promise.all(entries.filter(item => item.type === 'directory').map(async item => {
                try {
                    const files = await getJson('/posts/' + encodeURIComponent(item.name) + '/');
                    const post = files.find(file => file.name === 'post.md' && file.type === 'file');
                    return post ? { folder: item.name, post } : null;
                } catch (error) {
                    console.error('Failed to list post ' + item.name + ':', error);
                    return null;
                }
            }));
            container.replaceChildren();
            for (const entry of posts.filter(Boolean)) {
                const row = element('div', '');
                row.className = 'entry';
                const link = element('a', entry.folder);
                link.href = postHref(entry.folder);
                const meta = element('small', formatTime(entry.post.mtime) + ' · ' + formatSize(entry.post.size));
                const edit = element('button', '수정');
                edit.type = 'button';
                edit.addEventListener('click', () => editPost(entry.folder));
                row.append(link, meta, edit);
                container.append(row);
            }
            if (!container.childNodes.length) container.textContent = '아직 글이 없습니다.';
        } catch (error) {
            container.textContent = 'posts 목록을 불러오지 못했습니다. /posts/ JSON autoindex를 확인하세요.';
            console.error('Failed to load posts:', error);
        }
    }

    function openTab() {
        const pending = [showPosts()];
        if (markdownEditor && !$('post-upload-box').hidden) {
            requestAnimationFrame(() => markdownEditor.codemirror.refresh());
        }
        let folder = '';
        if (location.hash.startsWith('#posts/')) {
            try { folder = decodeURIComponent(location.hash.slice(7)); } catch {}
        }
        if (safeSegment(folder)) pending.push(showPost(folder));
        else { openFolder = null; $('post-view-box').hidden = true; }
        return Promise.all(pending);
    }

    $('add-image').addEventListener('click', addImage);
    folderInput.addEventListener('input', () => checkFolder());
    folderInput.addEventListener('change', () => checkFolder(0));
    $('post-source').addEventListener('input', () => { updateState(); refreshPreview(); });
    if (markdownEditor) markdownEditor.codemirror.on('change', () => { updateState(); refreshPreview(); });
    $('new-post').addEventListener('click', () => { editRequest++; openEditor(null, ''); });
    $('close-post-editor').addEventListener('click', () => {
        editRequest++; ++folderRequest; clearTimeout(folderTimer);
        clearImages(); $('post-upload-box').hidden = true;
        $('close-post-editor').hidden = true;
    });
    $('reset-post').addEventListener('click', () => { if (editingFolder) editPost(editingFolder); });
    $('unlock-post-title').addEventListener('click', () => {
        if (!editingFolder) return;
        folderInput.readOnly = !folderInput.readOnly;
        $('unlock-post-title').textContent = folderInput.readOnly ? '제목 변경' : '제목 변경 취소';
        if (folderInput.readOnly) folderInput.value = editingFolder;
        else { folderInput.focus(); folderInput.select(); }
        checkFolder(0);
    });
    $('confirm-post-rename').addEventListener('click', confirmRename);
    $('edit-open-post').addEventListener('click', () => { if (openFolder) editPost(openFolder); });
    $('verify-images').addEventListener('click', verifyImages);
    $('insert-markdown').addEventListener('click', () => insertReferences('markdown'));
    $('insert-html').addEventListener('click', () => insertReferences('html'));
    $('image-width').addEventListener('input', updateState);
    $('build-post').addEventListener('click', buildPost);
    $('confirm-post').addEventListener('click', confirmPost);
    showFolderState(); updateState();
    return { updateCommands: updateState, openTab,
        markdown: content => markdownEditor ? markdownEditor.markdown(content) : null };
}
