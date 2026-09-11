# Отчёт об ошибках: ViewAlign (MSA-viewer)

**Репозиторий:** https://github.com/Toki-bio/MSA-viewer  
**Приложение:** https://toki-bio.github.io/MSA-viewer/  
**Дата анализа:** 2026-07-16  
**Проанализированные файлы:** `script.js` (16101 строк), `server.js` (992 строки), `index.html` (1077 строк)

---

## Сводная таблица

| № | Файл | Строки | Описание | Серьёзность |
|---|------|--------|----------|-------------|
| 1 | server.js | 139–153 | `loadDbCache`: объект вместо строки → пустые БД BLAST | 🔴 Критично |
| 2 | server.js | 433, 490 | BLAST через `execSync` со строковой командой (shell injection) | 🔴 Высокий |
| 3 | script.js | 6403 | `JSON.parse` без `try-catch` в `loadPreset()` | 🔴 Высокий |
| 4 | script.js | 482–484 | `resp.json()` вызывается до проверки `resp.ok` | 🟠 Средний |
| 5 | script.js | 11563 | `atob()` вместо `_fromBase64Utf8()` для параметра `?data=` | 🟠 Средний |
| 6 | script.js | 6445, 6459 | `querySelector().checked = true` без null-проверки | 🟠 Средний |
| 7 | script.js | 13172–13179 | `loadColourPreset()` всегда берёт первый пресет | 🟠 Средний |
| 8 | script.js | 13210–13219 | Имена пресетов в `innerHTML`/`onclick` без HTML-экранирования | 🟠 Средний |
| 9 | script.js | 13243–13244 | Имена последовательностей в `innerHTML` без экранирования | 🟠 Средний |
| 10 | script.js | 1328, 3507, 3513, 6088, 6382, 6387, 13054 | `querySelector(':checked').value` без null-проверки | 🟡 Низкий |
| 11 | script.js | 8361, 8404, 8432, 8473, 8502, 11388, 12873 | `JSON.parse(localStorage...)` без `try-catch` | 🟡 Низкий |
| 12 | script.js | 13225 | Мёртвая переменная `modal` (объявлена, не используется) | 🟡 Код. качество |
| 13 | server.js | 990 | Хардкод внутреннего Tailscale IP в сообщении лога | 🟡 Код. качество |

---

## 🔴 Критические ошибки

---

### Ошибка №1 — `loadDbCache()`: неверный тип переменной, все BLAST-базы пустые

**Файл:** `server.js`, строки 139–153  
**Тип:** Логическая ошибка (неверный тип данных)  
**Влияние:** In-memory Smith–Waterman поиск никогда не возвращает результатов на ARM64 и при отсутствии BLAST+

#### Проблемный код

```javascript
function loadDbCache() {
    for (const [name, dbPath] of Object.entries(DATABASES)) {
        if (fs.existsSync(dbPath)) {              // ← dbPath — это объект { path, desc }, а не строка!
            console.log(`Loading ${name} into memory...`);
            DB_CACHE[name] = parseFasta(fs.readFileSync(dbPath, 'utf8'));  // ← тоже объект
            for (const e of DB_CACHE[name]) e._enc = encodeSeq(e.seq, 600);
            DB_INDEX[name] = buildInvertedIndex(DB_CACHE[name]);
        } else {
            console.warn(`  Not found: ${dbPath}`);
            DB_CACHE[name] = [];   // ← всегда попадает сюда!
        }
    }
}
```

#### Причина

`DATABASES` хранит значения формата `{ path: '/path/to/file.fa', desc: 'description' }`.  
`Object.entries(DATABASES)` даёт пары `[name, { path, desc }]`, а не `[name, pathString]`.  
`fs.existsSync({ path: '...' })` не находит файл (Node.js преобразует объект к `[object Object]`),  
поэтому все базы данных всегда загружаются как пустые массивы.

#### Исправление

```javascript
function loadDbCache() {
    for (const [name, dbInfo] of Object.entries(DATABASES)) {  // переименовать dbPath → dbInfo
        if (fs.existsSync(dbInfo.path)) {                       // обращаться к dbInfo.path
            console.log(`Loading ${name} into memory...`);
            const t0 = Date.now();
            DB_CACHE[name] = parseFasta(fs.readFileSync(dbInfo.path, 'utf8'));  // dbInfo.path
            for (const e of DB_CACHE[name]) e._enc = encodeSeq(e.seq, 600);
            DB_INDEX[name] = buildInvertedIndex(DB_CACHE[name]);
            console.log(`  ${DB_CACHE[name].length} sequences loaded + indexed in ${Date.now() - t0} ms`);
        } else {
            console.warn(`  Not found: ${dbInfo.path}`);
            DB_CACHE[name] = [];
        }
    }
}
```

---

### Ошибка №2 — Shell command injection в BLAST-эндпоинтах

**Файл:** `server.js`, строки 433 и 490  
**Тип:** Риск безопасности / архитектурная проблема  
**Влияние:** Потенциальная инъекция через оболочку при передаче специальных символов в путях

#### Проблемный код

```javascript
// Строка 433 (одиночный BLAST)
const blastCmd = `blastn -query "${queryFile}" -db "${dbBaseName}" -evalue ${evalue} -outfmt 5 -max_target_seqs ${maxHits} -out "${outputFile}"`;
execSync(blastCmd, { encoding: 'utf8', timeout: 60000 });

// Строка 490 (пакетный BLAST)
const blastCmd = `blastn -query "${queryFile}" -db "${dbBaseName}" -evalue ${evalue} -outfmt 5 -max_target_seqs 5 -out "${outputFile}"`;
execSync(blastCmd, { encoding: 'utf8', timeout: 60000, stdio: 'ignore' });
```

#### Причина

`execSync` с шаблонной строкой передаёт команду через системную оболочку (`/bin/sh`).  
Хотя числовые параметры (`evalue`, `maxHits`) проходят через `parseFloat`/`parseInt`,  
файловые пути включают `Date.now()` и `dbBaseName` (который может содержать спецсимволы).  
MAFFT в том же файле реализован правильно — через `spawn()` с массивом аргументов.

#### Исправление

```javascript
// Использовать spawn с массивом аргументов вместо execSync со строкой
const { spawnSync } = require('child_process');

const result = spawnSync('blastn', [
    '-query', queryFile,
    '-db', dbBaseName,
    '-evalue', String(evalue),
    '-outfmt', '5',
    '-max_target_seqs', String(maxHits),
    '-out', outputFile
], { encoding: 'utf8', timeout: 60000 });

if (result.status !== 0) {
    throw new Error(result.stderr || `blastn exited with code ${result.status}`);
}
```

---

### Ошибка №3 — `JSON.parse()` без `try-catch` в `loadPreset()`

**Файл:** `script.js`, строка 6403  
**Тип:** Необработанное исключение  
**Влияние:** При повреждённом значении в `localStorage` функция падает с необработанным `SyntaxError`

#### Проблемный код

```javascript
function loadPreset() {
    const saved = localStorage.getItem('qwen_msa_viewer_preset_v44');
    if (!saved) {
        showMessage("No saved preset found.", 3000);
        return;
    }
    const p = JSON.parse(saved);   // ← нет try-catch!
    // ... дальнейшее применение настроек
}
```

#### Исправление

```javascript
function loadPreset() {
    const saved = localStorage.getItem('qwen_msa_viewer_preset_v44');
    if (!saved) {
        showMessage("No saved preset found.", 3000);
        return;
    }
    let p;
    try {
        p = JSON.parse(saved);
    } catch (e) {
        console.error('Preset JSON corrupted:', e);
        showMessage("Saved preset is corrupted and was reset.", 4000);
        localStorage.removeItem('qwen_msa_viewer_preset_v44');
        return;
    }
    // ... дальнейшее применение настроек
}
```

---

## 🟠 Ошибки среднего приоритета

---

### Ошибка №4 — `resp.json()` вызывается до проверки `resp.ok`

**Файл:** `script.js`, строки 482–484  
**Тип:** Логическая ошибка порядка операций  
**Влияние:** HTTP-ошибки маскируются `SyntaxError` если тело ответа не является JSON

#### Проблемный код

```javascript
async function fetchFileFromServer(filePath, serverKey) {
    // ...
    const url = `/api/ssh-cat?file=${encodeURIComponent(filePath)}&server=${encodeURIComponent(serverKey)}`;
    const resp = await fetch(url);
    const data = await resp.json();   // ← тело читается ДО проверки resp.ok
    if (!resp.ok) {
        throw new Error(data.error || 'SSH fetch failed');
    }
    // ...
}
```

#### Причина

Если сервер вернул HTML-страницу ошибки (502, 504, nginx default page), вызов `resp.json()`  
бросает `SyntaxError: Unexpected token < in JSON`, что скрывает реальную причину ошибки.  
Более того, тело ответа (`resp.body`) уже потреблено и не может быть прочитано повторно.

#### Исправление

```javascript
const resp = await fetch(url);
if (!resp.ok) {
    let msg = `HTTP ${resp.status}: SSH fetch failed`;
    try {
        const err = await resp.json();
        if (err?.error) msg = err.error;
    } catch { /* тело не JSON — используем статус */ }
    throw new Error(msg);
}
const data = await resp.json();
```

---

### Ошибка №5 — `atob()` вместо `_fromBase64Utf8()` для параметра `?data=`

**Файл:** `script.js`, строка 11563  
**Тип:** Несогласованность кодирования  
**Влияние:** FASTA-данные с не-ASCII символами в заголовках повреждаются или вызывают `InvalidCharacterError`

#### Проблемный код

```javascript
} else if (autoSnapshot) {
    // snapshot параметр — используется правильный декодер
    const snapshotText = _fromBase64Utf8(autoSnapshot);  // ✓ корректно для UTF-8
    // ...
} else if (autoUrl) {
    // ...
} else if (autoData) {
    try {
        const text = atob(autoData);   // ✗ только Latin-1! UTF-8 символы будут повреждены
        // ...
    }
}
```

#### Причина

`atob()` поддерживает только Base64, закодированный из Latin-1 (ISO-8859-1).  
Функция `_fromBase64Utf8()` определена в этом же файле (строки 6478–6485) и корректно  
обрабатывает UTF-8 через `TextDecoder`. Параметр `?snapshot=` уже использует правильный  
декодер, но `?data=` — нет. FASTA-заголовки часто содержат не-ASCII символы.

#### Исправление

```javascript
} else if (autoData) {
    try {
        const text = _fromBase64Utf8(autoData);   // ← заменить atob() на _fromBase64Utf8()
        const fastaInputEl = el('fastaInput');
        if (fastaInputEl) fastaInputEl.value = text;
        state.currentFilename = autoTitle || 'Inline data';
        parseAndRender(true);
        showMessage('Alignment loaded from inline data', 2000);
    } catch (err) {
        console.error('Inline data decode failed:', err);
        showMessage(`Failed to decode data: ${err.message}`, 5000);
    }
}
```

---

### Ошибка №6 — `querySelector().checked = true` без null-проверки

**Файл:** `script.js`, строки 6445 и 6459  
**Тип:** Потенциальная ошибка `TypeError: Cannot set properties of null`  
**Влияние:** `loadPreset()` падает при наличии устаревших значений в пресете

#### Проблемный код

```javascript
function loadPreset() {
    // ...
    document.querySelector(`input[name="consensusType"][value="${p.consensusType}"]`).checked = true;
    // ...
    document.querySelector(`input[name="shadeMode"][value="${p.shadeMode}\"]`).checked = true;
}
```

#### Причина

Если пресет сохранён со значением, которое больше не существует в HTML (например, после  
обновления приложения появились новые опции или были переименованы старые), `querySelector()`  
вернёт `null`, и присвоение `.checked` бросит `TypeError`.

#### Исправление

```javascript
// Вариант 1: опциональная цепочка (ES2020+)
document.querySelector(`input[name="consensusType"][value="${p.consensusType}"]`)?.checked = true;

// Вариант 2: явная проверка (более совместимый)
const consTypeEl = document.querySelector(`input[name="consensusType"][value="${p.consensusType}"]`);
if (consTypeEl) consTypeEl.checked = true;

const shadeModeEl = document.querySelector(`input[name="shadeMode"][value="${p.shadeMode}"]`);
if (shadeModeEl) shadeModeEl.checked = true;
```

---

### Ошибка №7 — `loadColourPreset()` всегда загружает первый пресет

**Файл:** `script.js`, строки 13172–13183  
**Тип:** Функциональная ошибка (незавершённая реализация)  
**Влияние:** При нескольких пресетах кнопка «Load» игнорирует выбор пользователя

#### Проблемный код

```javascript
function loadColourPreset() {
    if (Object.keys(colourState.presets).length === 0) {
        showMessage('No saved presets', 2000);
        return;
    }

    const presetNames = Object.keys(colourState.presets);
    const presetName = presetNames[0]; // TODO: could add dialog to select   ← всегда первый!

    colourState.mappings = new Map(colourState.presets[presetName]);
    applyColourToSeqNames(colourState.mappings);
    showMessage(`Loaded preset '${presetName}'`, 2000);
}
```

#### Причина

Функция `updateColourPresetList()` рендерит список пресетов с кликабельными элементами,  
что создаёт у пользователя иллюзию выбора. Однако кнопка «Load» (которая вызывает  
`loadColourPreset()`) игнорирует отображаемый список и всегда загружает `presetNames[0]`.

#### Исправление

```javascript
// В HTML добавить <select id="colourPresetSelect"> и заполнять его из updateColourPresetList()
// Или — читать выбранный элемент через data-атрибут:
function loadColourPreset() {
    const selected = document.querySelector('.colour-preset-item.selected');
    const presetName = selected?.dataset.name || Object.keys(colourState.presets)[0];
    if (!presetName || !colourState.presets[presetName]) {
        showMessage('No preset selected', 2000);
        return;
    }
    colourState.mappings = new Map(colourState.presets[presetName]);
    applyColourToSeqNames(colourState.mappings);
    showMessage(`Loaded preset '${presetName}'`, 2000);
}
```

---

### Ошибка №8 — Имена пресетов в `innerHTML` без HTML-экранирования

**Файл:** `script.js`, строки 13210–13219  
**Тип:** HTML/JS injection  
**Влияние:** Имена пресетов с спецсимволами ломают разметку или выполняют произвольный JS

#### Проблемный код

```javascript
function updateColourPresetList() {
    // ...
    presetItems.innerHTML = Object.keys(presets).map(name =>
        `<div onclick="(function() {
            colourState.mappings = new Map(colourState.presets['${name}']);  // ← name не экранирован
            applyColourToSeqNames(colourState.mappings);
            showMessage('Loaded ${name}', 2000);   // ← name не экранирован
          })()">
            ${name} <span onclick="delete colourState.presets['${name}']...">x</span>
        </div>`   // ← name вставляется как HTML напрямую
    ).join('');
}
```

#### Причина

Пресет с именем `'); alert('XSS'); ('` сломает `onclick`-обработчик.  
Пресет с именем `<script>alert(1)</script>` может исполниться при вставке в `innerHTML`.  
Функция `_escapeHtml()` уже существует в коде (строка 222), но не применяется здесь.

#### Исправление

```javascript
function updateColourPresetList() {
    const presetList = el('colourPresetList');
    const presetItems = el('presetItems');
    const presets = colourState.presets;

    if (Object.keys(presets).length === 0) {
        presetList.style.display = 'none';
        return;
    }

    presetList.style.display = 'block';
    presetItems.innerHTML = '';  // очищаем

    Object.keys(presets).forEach(name => {
        const div = document.createElement('div');
        div.style.cssText = 'cursor:pointer;padding:2px;border-radius:2px;margin:2px 0;background:#f0f0f0;';
        div.dataset.name = name;       // имя в data-атрибуте, не в JS

        const nameSpan = document.createElement('span');
        nameSpan.textContent = name;   // textContent — безопасно

        const delSpan = document.createElement('span');
        delSpan.textContent = 'x';
        delSpan.style.cssText = 'float:right;cursor:pointer;color:#888;';
        delSpan.addEventListener('click', (e) => {
            e.stopPropagation();
            delete colourState.presets[name];
            localStorage.setItem('seqColourPresets', JSON.stringify(colourState.presets));
            updateColourPresetList();
        });

        div.addEventListener('click', () => {
            colourState.mappings = new Map(colourState.presets[name]);
            applyColourToSeqNames(colourState.mappings);
            showMessage(`Loaded ${name}`, 2000);
        });

        div.appendChild(nameSpan);
        div.appendChild(delSpan);
        presetItems.appendChild(div);
    });
}
```

---

### Ошибка №9 — Имена последовательностей в `innerHTML` без экранирования

**Файл:** `script.js`, строки 13242–13244 (функция `showColorHistory()`)  
**Тип:** HTML injection  
**Влияние:** FASTA-заголовки с HTML-символами ломают отображение в инспекторе цвета

#### Проблемный код

```javascript
sortedNames.forEach(seqName => {
    // ...
    html += `<div style="...border-left: 3px solid ${currentColor};">`;
    html += `<div style="font-weight: bold; ...">${seqName}</div>`;       // ← не экранировано
    html += `<div style="...">Current: <span style="...background: ${currentColor};..."></span> ${currentColor}</div>`;
    // ...
    history.forEach((entry, idx) => {
        html += `<span style="color: #0066cc;">← ${entry.method}</span>`;  // ← entry.method не экранирован
    });
```

#### Причина

Имена последовательностей из FASTA-файлов могут содержать `<`, `>`, `&`, `"`.  
Функция `_escapeHtml()` уже определена в коде (строка 222).

#### Исправление

```javascript
html += `<div style="font-weight: bold; margin-bottom: 4px; word-break: break-all;">${_escapeHtml(seqName)}</div>`;
// ...
html += `<span style="color: #0066cc; margin: 0 4px;">← ${_escapeHtml(entry.method)}</span>`;
```

---

## 🟡 Ошибки низкого приоритета / качество кода

---

### Ошибка №10 — `querySelector(':checked').value` без null-проверки (множественные случаи)

**Файл:** `script.js`  
**Строки:** 1328, 3507, 3513, 6088, 6382, 6387, 13054

#### Проблемный паттерн

```javascript
// Примеры из разных мест кода:
consType: document.querySelector('input[name="consensusType"]:checked').value,   // строка 1328
const consType = document.querySelector('input[name="consensusType"]:checked').value;  // строка 3507
const shadeMode = document.querySelector('input[name="shadeMode"]:checked').value;     // строка 3513
const mode = document.querySelector('input[name="colourMode"]:checked').value;         // строка 13054
```

Если ни один radio-button не выбран (например, при программном изменении DOM или ошибке HTML),  
`querySelector()` вернёт `null` и `.value` бросит `TypeError`.

#### Исправление

```javascript
// Опциональная цепочка с дефолтным значением:
const consType = document.querySelector('input[name="consensusType"]:checked')?.value ?? 'normal';
const shadeMode = document.querySelector('input[name="shadeMode"]:checked')?.value ?? 'nongap';
const mode = document.querySelector('input[name="colourMode"]:checked')?.value ?? 'discrete';
```

---

### Ошибка №11 — `JSON.parse(localStorage.getItem(...))` без `try-catch` (множественные случаи)

**Файл:** `script.js`  
**Строки:** 8361, 8404, 8432, 8473, 8502, 11388, 12873

#### Проблемный паттерн

```javascript
// Встречается многократно в разных функциях:
let presets = JSON.parse(localStorage.getItem('clusteringPresets') || '{}');  // строки 8361, 8404, 8432...
const presets = JSON.parse(localStorage.getItem('clusteringPresets') || '{}'); // строка 11388
presets: JSON.parse(localStorage.getItem('seqColourPresets') || '{}')          // строка 12873
```

`JSON.parse` может бросить `SyntaxError` если значение в `localStorage` повреждено.

#### Исправление (вспомогательная функция)

```javascript
// Добавить в начало script.js:
function safeLocalGet(key, fallback = {}) {
    try {
        const raw = localStorage.getItem(key);
        return raw ? JSON.parse(raw) : fallback;
    } catch (e) {
        console.warn(`localStorage key "${key}" is corrupted, resetting.`, e);
        localStorage.removeItem(key);
        return fallback;
    }
}

// Затем заменить все JSON.parse(localStorage.getItem(...) || '{}') на:
let presets = safeLocalGet('clusteringPresets');
```

---

### Ошибка №12 — Мёртвая переменная `modal` в `showColorHistory()`

**Файл:** `script.js`, строка 13225  
**Тип:** Лишний код (dead code)

#### Проблемный код

```javascript
function showColorHistory() {
    const modal = el('colourInspectorModal');   // ← объявляется, но никогда не используется
    const content = el('colourHistoryContent');
    // ... modal нигде не применяется в функции
    showExclusiveModal('colourInspectorModal'); // используется строка, а не переменная
}
```

#### Исправление

Удалить строку `const modal = el('colourInspectorModal');`.

---

### Ошибка №13 — Хардкод внутреннего Tailscale IP в логе сервера

**Файл:** `server.js`, строка 990  
**Тип:** Утечка инфраструктурной информации

#### Проблемный код

```javascript
app.listen(PORT, '0.0.0.0', () => {
    console.log(`ViewAlign server running on http://localhost:${PORT}  (also on Tailscale 100.78.77.10:${PORT})`);
    loadDbCache();
```

Внутренний IP-адрес Tailscale сети захардкожен в исходном коде.

#### Исправление

```javascript
const TAILSCALE_IP = process.env.TAILSCALE_IP || '';
const tailscaleMsg = TAILSCALE_IP ? `  (also on Tailscale ${TAILSCALE_IP}:${PORT})` : '';
console.log(`ViewAlign server running on http://localhost:${PORT}${tailscaleMsg}`);
```

---

## Дополнительные наблюдения

### Хорошо реализованные части кода

- **MAFFT** (`server.js`, строки 622–634): правильно использует `spawn()` с массивом аргументов и whitelist допустимых опций — эталон для исправления BLAST
- **SSH path traversal защита** (`server.js`, строки 818–819, 907–908): блокирует `..` и shell-метасимволы
- **Recent history** (`script.js`, строка 222): имеет правильный `_escapeHtml()` — нужно применять везде
- **`_fromBase64Utf8`** (`script.js`, строки 6478–6485): корректная реализация UTF-8 декодирования
- **localStorage** с ограничением размера истории — грамотная реализация

### Рекомендации по архитектуре

1. **Создать утилитарную функцию `safeLocalGet(key, fallback)`** и заменить все прямые `JSON.parse(localStorage...)` — устранит класс ошибок №3, №11
2. **Создать утилитарную функцию `esc(str)`** как алиас для `_escapeHtml()` и применять её везде при вставке в innerHTML — устранит ошибки №8, №9
3. **Заменить все `execSync` в BLAST-эндпоинтах на `spawnSync` с массивом аргументов** по образцу MAFFT — устранит ошибку №2
4. **Добавить ESLint** с правилами `no-unused-vars`, `no-unsafe-innerhtml` (eslint-plugin-no-unsanitized) для автоматической проверки подобных проблем

---

*Отчёт сгенерирован автоматически на основе статического анализа исходного кода.*  
*Репозиторий: https://github.com/Toki-bio/MSA-viewer (ветка `main`, дата: 2026-07-16)*
