/* ==========================================================
   Media Catalog - lógica
   Los datos viven en catalog.json: para agregar contenido
   solo hay que ampliar ese archivo, no este código.
   ========================================================== */

/* ---------- CONFIGURACIÓN (lo único que quizás quieras tocar) ---------- */
const CONFIG = {
    catalogFile: 'catalog.json',   // archivo de datos
    imagesFolder: 'imagenes/',     // carpeta de imágenes
    randomTagCount: 5,             // etiquetas al azar con el buscador vacío
    suggestionCount: 8,            // máximo de etiquetas sugeridas al escribir
    pageSize: 20,                  // tarjetas que se cargan por vez
    newestFirst: true,             // true = lo último agregado al JSON aparece primero

    // Servidores de video. "key" es el nombre que se usa dentro de "enlaces" en el JSON.
    // Para sumar un servidor nuevo: agregá una línea acá y usá esa key en el JSON.
    servers: [
        { key: 'doodstream', label: 'Opción 1', name: 'Doodstream' },
        { key: 'streamtape', label: 'Opción 2', name: 'Streamtape' }
    ]
};

/* ---------- ESTADO ---------- */
const state = {
    videos: [],        // todos los videos ya normalizados
    allTags: [],       // todas las etiquetas posibles (personajes, universos, animadores)
    randomTags: [],    // las 5 etiquetas al azar que se muestran sin búsqueda
    selectedTag: null, // etiqueta activa (o null)
    query: '',         // texto del buscador
    filtered: [],      // resultado del filtro actual
    shown: 0           // cuántas tarjetas se están mostrando
};

/* ---------- REFERENCIAS AL DOM ---------- */
const $searchBar = document.getElementById('searchBar');
const $tagsList = document.getElementById('tagsList');
const $rerollBtn = document.getElementById('rerollBtn');
const $counter = document.getElementById('resultsCounter');
const $grid = document.getElementById('catalogGrid');
const $moreBtn = document.getElementById('moreBtn');

/* ==========================================================
   UTILIDADES DE TEXTO
   ========================================================== */

// Pasa a minúsculas y quita tildes, para que "Nilú" y "nilu" coincidan al buscar.
function normalizeText(text) {
    return String(text || '')
        .toLowerCase()
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .trim();
}

// Quita el número final de un personaje: "mona 1" y "mona 2" -> "mona".
// Así las variantes cuentan como una sola etiqueta.
function stripTrailingNumber(name) {
    return String(name || '').replace(/\s+\d+$/, '').trim();
}

// Solo permite enlaces http/https (evita cosas como "javascript:...").
function isSafeUrl(url) {
    try {
        const parsed = new URL(url);
        return parsed.protocol === 'http:' || parsed.protocol === 'https:';
    } catch (e) {
        return false;
    }
}

// Crea un elemento HTML con clase y texto. Usar textContent evita inyectar HTML desde el JSON.
function el(tag, className, text) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined) node.textContent = text;
    return node;
}

/* ==========================================================
   CARGA Y NORMALIZACIÓN DE DATOS
   ========================================================== */

async function init() {
    try {
        const response = await fetch(CONFIG.catalogFile);
        if (!response.ok) throw new Error('No se pudo cargar ' + CONFIG.catalogFile);
        const raw = await response.json();

        state.videos = prepareVideos(raw);
        state.allTags = buildTagIndex(state.videos);
        state.randomTags = pickRandomTags();

        // Eventos
        $searchBar.addEventListener('input', onSearchInput);
        $rerollBtn.addEventListener('click', () => {
            state.randomTags = pickRandomTags();
            renderTags();
        });
        $moreBtn.addEventListener('click', showMore);

        renderTags();
        applyFilters();
    } catch (error) {
        console.error('Error al inicializar el catálogo:', error);
        $counter.textContent = 'Error al cargar catalog.json. Revisá que el archivo exista y no tenga errores de comas o comillas.';
    }
}

// Convierte cada entrada del JSON a un formato interno uniforme.
function prepareVideos(raw) {
    const list = (Array.isArray(raw) ? raw : []).map((item, index) => {
        // "personajes" puede venir como lista o como texto suelto
        const personajes = Array.isArray(item.personajes)
            ? item.personajes
            : (item.personajes ? [item.personajes] : []);

        // "enlaces" es el formato nuevo: { "doodstream": "...", "streamtape": "..." }
        const enlaces = Object.assign({}, item.enlaces);

        // Compatibilidad: el campo viejo "url" cuenta como Opción 1 (doodstream)
        if (item.url && !enlaces.doodstream) enlaces.doodstream = item.url;

        const video = {
            id: item.id ? String(item.id) : '',
            animador: item.animador || '',
            universo: item.universo || '',
            personajes: personajes,
            imagen: item.imagen || '',
            fecha: item.fecha || '',   // opcional, formato AAAA-MM-DD
            enlaces: enlaces,
            _index: index              // posición original en el JSON
        };

        // Texto único donde busca el buscador (sin tildes, en minúsculas)
        video._search = normalizeText(
            [video.id, video.animador, video.universo].concat(video.personajes).join(' ')
        );
        return video;
    });

    // Orden: primero por fecha (si la tienen), luego por posición en el JSON
    list.sort((a, b) => {
        const byDate = b.fecha.localeCompare(a.fecha);
        if (byDate !== 0) return byDate;
        return CONFIG.newestFirst ? b._index - a._index : a._index - b._index;
    });

    return list;
}

/* ==========================================================
   ETIQUETAS
   ========================================================== */

// Arma la lista única de etiquetas a partir de los videos.
function buildTagIndex(videos) {
    const map = new Map();

    function add(type, label) {
        const norm = normalizeText(label);
        if (!norm) return;
        const key = type + ':' + norm;
        if (!map.has(key)) map.set(key, { key: key, type: type, norm: norm, label: label.toLowerCase().trim() });
    }

    videos.forEach(v => {
        add('animator', v.animador);
        add('universe', v.universo);
        v.personajes.forEach(p => add('character', stripTrailingNumber(p)));
    });

    return Array.from(map.values());
}

// Elige N etiquetas al azar (mezcla Fisher-Yates).
function pickRandomTags() {
    const pool = state.allTags.slice();
    for (let i = pool.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [pool[i], pool[j]] = [pool[j], pool[i]];
    }
    return pool.slice(0, CONFIG.randomTagCount);
}

// Dibuja las etiquetas visibles: al azar si no hay búsqueda, sugeridas si hay texto.
function renderTags() {
    const query = normalizeText(state.query);
    let list;

    if (query) {
        // Se compara con la última palabra escrita, así "keke col" sugiere "columbina"
        const lastWord = query.split(/\s+/).pop();
        list = state.allTags
            .filter(t => t.norm.includes(lastWord))
            // las que empiezan con lo escrito van primero, después alfabético
            .sort((a, b) => (b.norm.startsWith(lastWord) - a.norm.startsWith(lastWord)) || a.norm.localeCompare(b.norm))
            .slice(0, CONFIG.suggestionCount);
    } else {
        list = state.randomTags.slice();
    }

    // La etiqueta activa siempre se ve primero, para poder desactivarla
    if (state.selectedTag) {
        list = [state.selectedTag].concat(list.filter(t => t.key !== state.selectedTag.key));
    }

    $tagsList.innerHTML = '';
    if (list.length === 0) {
        $tagsList.appendChild(el('span', 'tags-empty', 'Sin etiquetas para esa búsqueda'));
    }

    list.forEach(tag => {
        const isActive = state.selectedTag && state.selectedTag.key === tag.key;
        const btn = el('button', 'tag tag--' + tag.type + (isActive ? ' active' : ''), tag.label);
        btn.type = 'button';
        btn.addEventListener('click', () => onTagClick(tag));
        $tagsList.appendChild(btn);
    });

    // El botón de sortear solo tiene sentido con el buscador vacío
    $rerollBtn.hidden = Boolean(query);
}

function onTagClick(tag) {
    const alreadyActive = state.selectedTag && state.selectedTag.key === tag.key;
    state.selectedTag = alreadyActive ? null : tag;

    // Al elegir una etiqueta se limpia el texto: la etiqueta ya hace de filtro
    if (!alreadyActive) {
        state.query = '';
        $searchBar.value = '';
    }

    renderTags();
    applyFilters();
}

/* ==========================================================
   BÚSQUEDA Y FILTRO
   ========================================================== */

function onSearchInput() {
    state.query = $searchBar.value;
    renderTags();
    applyFilters();
}

function videoMatchesTag(video, tag) {
    if (tag.type === 'animator') return normalizeText(video.animador) === tag.norm;
    if (tag.type === 'universe') return normalizeText(video.universo) === tag.norm;
    if (tag.type === 'character') {
        return video.personajes.some(p => normalizeText(stripTrailingNumber(p)) === tag.norm);
    }
    return true;
}

// Aplica etiqueta activa + texto del buscador y vuelve a dibujar desde la primera página.
function applyFilters() {
    const words = normalizeText(state.query).split(/\s+/).filter(Boolean);

    state.filtered = state.videos.filter(video => {
        if (state.selectedTag && !videoMatchesTag(video, state.selectedTag)) return false;
        // Todas las palabras escritas deben aparecer en algún campo del video
        return words.every(word => video._search.includes(word));
    });

    state.shown = 0;
    $grid.innerHTML = '';
    showMore();
}

/* ==========================================================
   TARJETAS
   ========================================================== */

// Agrega la siguiente "página" de tarjetas (se usa al filtrar y con el botón "Ver más").
function showMore() {
    const total = state.filtered.length;
    $counter.textContent = total + (total === 1 ? ' video' : ' videos');

    if (total === 0) {
        $grid.appendChild(el('div', 'empty-state', 'No se encontraron videos. Probá con otra etiqueta o palabra.'));
        $moreBtn.hidden = true;
        return;
    }

    const next = state.filtered.slice(state.shown, state.shown + CONFIG.pageSize);
    next.forEach(video => $grid.appendChild(createCard(video)));
    state.shown += next.length;

    const remaining = total - state.shown;
    $moreBtn.hidden = remaining <= 0;
    $moreBtn.textContent = 'Ver más (' + remaining + ' restantes)';
}

function createCard(video) {
    const card = el('article', 'video-card');

    // --- Imagen (con letra inicial de respaldo) ---
    const imageBox = el('div', 'card-image');
    const firstCharacter = stripTrailingNumber(video.personajes[0] || '');
    imageBox.appendChild(el('div', 'avatar-placeholder', firstCharacter ? firstCharacter.charAt(0).toUpperCase() : '🎬'));

    if (video.imagen) {
        const img = document.createElement('img');
        img.src = encodeURI(CONFIG.imagesFolder + video.imagen);
        img.alt = firstCharacter;
        img.loading = 'lazy';
        // Si la imagen no existe, se quita y queda visible la letra inicial
        img.addEventListener('error', () => img.remove());
        imageBox.appendChild(img);
    }
    card.appendChild(imageBox);

    // --- Texto ---
    const body = el('div', 'card-body');
    body.appendChild(el('div', 'card-title', video.personajes.join(', ') || 'Sin título'));

    const badges = el('div', 'card-badges');
    if (video.animador) badges.appendChild(el('span', 'badge badge-animator', '@' + video.animador));
    if (video.universo) badges.appendChild(el('span', 'badge badge-universe', video.universo));
    body.appendChild(badges);

    // --- Botones de enlaces: uno por servidor que tenga link en el JSON ---
    const actions = el('div', 'card-actions');
    let linkCount = 0;

    CONFIG.servers.forEach((server, i) => {
        const url = video.enlaces[server.key];
        if (!url || !isSafeUrl(url)) return;

        const link = el('a', 'action-button action-button--' + (i + 1), server.label);
        link.href = url;
        link.target = '_blank';
        link.rel = 'noopener noreferrer';
        link.title = server.name;
        actions.appendChild(link);
        linkCount++;
    });

    if (linkCount === 0) actions.appendChild(el('span', 'no-link', 'Sin enlace'));
    body.appendChild(actions);

    card.appendChild(body);
    return card;
}

/* ---------- ARRANQUE ---------- */
window.addEventListener('DOMContentLoaded', init);
