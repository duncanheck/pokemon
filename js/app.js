/**
 * Card Vault - Trading Card Tracker
 * Main application logic with event delegation (no inline handlers).
 */

let valueChart = null;

// Temporary store for search results so we can reference them by index
// instead of embedding JSON in onclick attributes.
const searchResultCache = { pokemon: [], onepiece: [], invincible: [] };

// === Page Navigation ===
function showPage(page) {
  document.querySelectorAll('.page-content').forEach(p => p.classList.add('d-none'));
  const target = document.getElementById('page-' + page);
  if (target) target.classList.remove('d-none');

  // Update desktop nav
  document.querySelectorAll('.navbar [data-page]').forEach(l => l.classList.remove('active'));
  const desktopLink = document.querySelector(`.navbar [data-page="${page}"]`);
  if (desktopLink) desktopLink.classList.add('active');

  // Update mobile bottom nav
  document.querySelectorAll('.bottom-nav [data-page]').forEach(l => l.classList.remove('active'));
  const mobileLink = document.querySelector(`.bottom-nav [data-page="${page}"]`);
  if (mobileLink) mobileLink.classList.add('active');

  if (page === 'dashboard') refreshDashboard();
  if (['pokemon', 'onepiece', 'invincible'].includes(page)) renderCollection(page);
}

// Delegated click handler for all [data-page] links
document.addEventListener('click', (e) => {
  const pageLink = e.target.closest('[data-page]');
  if (pageLink) {
    e.preventDefault();
    showPage(pageLink.getAttribute('data-page'));
    return;
  }

  // Dashboard stat card clicks
  const pageCard = e.target.closest('[data-page-link]');
  if (pageCard && pageCard.classList.contains('clickable')) {
    showPage(pageCard.getAttribute('data-page-link'));
    return;
  }

  // Add card buttons
  const addBtn = e.target.closest('[data-add-card]');
  if (addBtn) {
    openAddCardModal(addBtn.getAttribute('data-add-card'));
    return;
  }

  // Collection card click -> detail
  const collCard = e.target.closest('[data-card-id]');
  if (collCard && !e.target.closest('button')) {
    const category = collCard.getAttribute('data-category');
    const cardId = collCard.getAttribute('data-card-id');
    showCardDetail(category, cardId);
    return;
  }

  // Search result "Add to Collection" button
  const addSearchBtn = e.target.closest('[data-search-add]');
  if (addSearchBtn) {
    const cat = addSearchBtn.getAttribute('data-search-cat');
    const idx = parseInt(addSearchBtn.getAttribute('data-search-add'), 10);
    const cached = searchResultCache[cat];
    if (cached && cached[idx]) {
      openAddCardModal(cat, cached[idx]);
    }
    return;
  }

  // Manual add from search status
  const manualAddBtn = e.target.closest('[data-manual-add]');
  if (manualAddBtn) {
    const cat = manualAddBtn.getAttribute('data-manual-add');
    const name = manualAddBtn.getAttribute('data-manual-name') || '';
    openAddCardModal(cat, { name });
    return;
  }
});

// Lookup tab navigation
document.querySelectorAll('[data-lookup]').forEach(link => {
  link.addEventListener('click', (e) => {
    e.preventDefault();
    const tab = link.getAttribute('data-lookup');
    document.querySelectorAll('.lookup-content').forEach(c => c.classList.add('d-none'));
    document.getElementById('lookup-' + tab).classList.remove('d-none');
    document.querySelectorAll('#lookupTabs .nav-link').forEach(l => l.classList.remove('active'));
    link.classList.add('active');
  });
});

// Filter inputs
document.querySelectorAll('[data-filter]').forEach(input => {
  input.addEventListener('input', () => {
    renderCollection(input.getAttribute('data-filter'));
  });
});

// Sort selects
document.querySelectorAll('[data-sort]').forEach(select => {
  select.addEventListener('change', () => {
    renderCollection(select.getAttribute('data-sort'));
  });
});

// === Dashboard ===
function refreshDashboard() {
  const stats = Storage.getAllStats();

  document.getElementById('total-value').textContent = formatCurrency(stats.total.totalValue);
  document.getElementById('total-cards').textContent = stats.total.totalCards;
  document.getElementById('pokemon-value').textContent = formatCurrency(stats.pokemon.totalValue);
  document.getElementById('pokemon-count').textContent = stats.pokemon.totalCards;
  document.getElementById('onepiece-value').textContent = formatCurrency(stats.onepiece.totalValue);
  document.getElementById('onepiece-count').textContent = stats.onepiece.totalCards;
  document.getElementById('invincible-value').textContent = formatCurrency(stats.invincible.totalValue);
  document.getElementById('invincible-count').textContent = stats.invincible.totalCards;

  renderValueChart(stats);
  renderTopCards();
  renderRecentCards();
}

function renderValueChart(stats) {
  const ctx = document.getElementById('valueChart').getContext('2d');
  if (valueChart) valueChart.destroy();

  const hasData = stats.total.totalValue > 0;

  valueChart = new Chart(ctx, {
    type: 'doughnut',
    data: {
      labels: ['Pokemon', 'One Piece', 'Invincible'],
      datasets: [{
        data: hasData
          ? [stats.pokemon.totalValue, stats.onepiece.totalValue, stats.invincible.totalValue]
          : [1, 1, 1],
        backgroundColor: hasData
          ? ['#f0c040', '#ef4444', '#00b4d8']
          : ['#333', '#333', '#333'],
        borderWidth: 0,
      }]
    },
    options: {
      responsive: true,
      plugins: {
        legend: {
          position: 'bottom',
          labels: { color: '#ccc', padding: 15, font: { size: 12 } }
        },
        tooltip: {
          callbacks: {
            label: (item) => hasData ? `${item.label}: ${formatCurrency(item.raw)}` : 'No data'
          }
        }
      },
      cutout: '65%',
    }
  });
}

function renderTopCards() {
  const container = document.getElementById('top-cards-list');
  const topCards = Storage.getTopCards(5);

  if (topCards.length === 0) {
    container.innerHTML = '<p class="text-muted">No cards added yet.</p>';
    return;
  }

  container.innerHTML = topCards.map((card, i) => {
    const totalVal = (parseFloat(card.value) || 0) * (parseInt(card.quantity) || 1);
    return `
      <div class="top-card-item">
        <div>
          <span class="text-muted me-2">#${i + 1}</span>
          ${getCategoryIcon(card.category)}
          <strong>${escapeHtml(card.name)}</strong>
          <span class="text-muted ms-1 small">${escapeHtml(card.set || '')}</span>
        </div>
        <span class="fw-bold text-success text-nowrap">${formatCurrency(totalVal)}</span>
      </div>
    `;
  }).join('');
}

function renderRecentCards() {
  const container = document.getElementById('recent-cards-list');
  const recent = Storage.getRecentCards(8);

  if (recent.length === 0) {
    container.innerHTML = '<p class="text-muted">No cards added yet.</p>';
    return;
  }

  container.innerHTML = `
    <div class="table-responsive">
      <table class="table table-dark table-sm table-hover mb-0">
        <thead>
          <tr>
            <th>Card</th>
            <th>Category</th>
            <th class="d-none d-sm-table-cell">Set</th>
            <th>Value</th>
            <th class="d-none d-md-table-cell">Added</th>
          </tr>
        </thead>
        <tbody>
          ${recent.map(card => `
            <tr>
              <td>${escapeHtml(card.name)}</td>
              <td>${getCategoryBadge(card.category)}</td>
              <td class="text-muted d-none d-sm-table-cell">${escapeHtml(card.set || '-')}</td>
              <td class="text-success fw-bold">${formatCurrency(parseFloat(card.value) || 0)}</td>
              <td class="text-muted d-none d-md-table-cell">${formatDate(card.addedAt)}</td>
            </tr>
          `).join('')}
        </tbody>
      </table>
    </div>
  `;
}

// === Collection Rendering ===
function renderCollection(category) {
  const container = document.getElementById('collection-' + category);
  let cards = Storage.getCollection(category);
  const sortEl = document.getElementById('sort-' + category);
  const sortVal = sortEl ? sortEl.value : 'date-desc';

  cards = sortCards(cards, sortVal);

  const filterInput = document.getElementById('filter-' + category);
  if (filterInput && filterInput.value.trim()) {
    const q = filterInput.value.trim().toLowerCase();
    cards = cards.filter(c =>
      (c.name || '').toLowerCase().includes(q) ||
      (c.set || '').toLowerCase().includes(q) ||
      (c.number || '').toLowerCase().includes(q) ||
      (c.rarity || '').toLowerCase().includes(q)
    );
  }

  if (cards.length === 0) {
    container.innerHTML = `
      <div class="col-12 empty-state">
        <i class="bi bi-collection"></i>
        <h5>No cards yet</h5>
        <p>Tap "Add Card" or use Card Lookup to find and add cards.</p>
      </div>
    `;
    return;
  }

  container.innerHTML = cards.map(card => {
    const totalVal = (parseFloat(card.value) || 0) * (parseInt(card.quantity) || 1);
    const purchaseTotal = (parseFloat(card.purchasePrice) || 0) * (parseInt(card.quantity) || 1);
    const profitLoss = purchaseTotal > 0 ? totalVal - purchaseTotal : 0;
    const profitClass = profitLoss > 0 ? 'profit' : profitLoss < 0 ? 'loss' : 'neutral';
    const profitStr = purchaseTotal > 0
      ? `<span class="${profitClass}">${profitLoss >= 0 ? '+' : ''}${formatCurrency(profitLoss)}</span>`
      : '';

    return `
      <div class="col-6 col-md-4 col-lg-3 col-xl-2">
        <div class="collection-card" data-card-id="${escapeAttr(card.id)}" data-category="${escapeAttr(category)}">
          ${card.imageUrl
            ? `<img src="${escapeAttr(card.imageUrl)}" class="card-img-top" alt="${escapeAttr(card.name)}" loading="lazy">`
            : `<div class="no-image"><i class="bi bi-image"></i></div>`
          }
          <div class="card-body">
            <div class="card-title" title="${escapeAttr(card.name)}">${escapeHtml(card.name)}</div>
            <div class="card-meta">${escapeHtml(card.set || '')} ${card.number ? '#' + escapeHtml(card.number) : ''}</div>
            ${card.rarity ? `<span class="badge badge-rarity ${getRarityClass(card.rarity)}">${escapeHtml(card.rarity)}</span>` : ''}
            <div class="d-flex justify-content-between align-items-center mt-1">
              <span class="card-value">${formatCurrency(totalVal)}</span>
              ${card.quantity > 1 ? `<span class="card-meta">x${card.quantity}</span>` : ''}
            </div>
            ${profitStr ? `<div class="card-meta">${profitStr}</div>` : ''}
          </div>
        </div>
      </div>
    `;
  }).join('');
}

function sortCards(cards, sortVal) {
  const sorted = [...cards];
  switch (sortVal) {
    case 'date-desc': sorted.sort((a, b) => new Date(b.addedAt) - new Date(a.addedAt)); break;
    case 'date-asc': sorted.sort((a, b) => new Date(a.addedAt) - new Date(b.addedAt)); break;
    case 'value-desc': sorted.sort((a, b) => cardTotal(b) - cardTotal(a)); break;
    case 'value-asc': sorted.sort((a, b) => cardTotal(a) - cardTotal(b)); break;
    case 'name-asc': sorted.sort((a, b) => (a.name || '').localeCompare(b.name || '')); break;
  }
  return sorted;
}

function cardTotal(c) {
  return (parseFloat(c.value) || 0) * (parseInt(c.quantity) || 1);
}

// === Add / Edit Card Modal ===
function openAddCardModal(category, prefill = {}) {
  document.getElementById('card-id').value = prefill.id || '';
  document.getElementById('card-category').value = category;
  document.getElementById('card-name').value = prefill.name || '';
  document.getElementById('card-set').value = prefill.set || '';
  document.getElementById('card-number').value = prefill.number || '';
  document.getElementById('card-rarity').value = prefill.rarity || '';
  document.getElementById('card-condition').value = prefill.condition || 'Near Mint';
  document.getElementById('card-quantity').value = prefill.quantity || 1;
  document.getElementById('card-purchase-price').value = prefill.purchasePrice || '';
  document.getElementById('card-value').value = prefill.value || '';
  document.getElementById('card-image-url').value = prefill.imageUrl || '';
  document.getElementById('card-notes').value = prefill.notes || '';

  document.getElementById('addCardModalTitle').textContent = prefill.id ? 'Edit Card' : 'Add Card';
  new bootstrap.Modal(document.getElementById('addCardModal')).show();
}

function saveCard() {
  const name = document.getElementById('card-name').value.trim();
  const value = document.getElementById('card-value').value;

  if (!name) { alert('Please enter a card name.'); return; }
  if (!value || parseFloat(value) < 0) { alert('Please enter a valid current value.'); return; }

  const cardData = {
    name,
    set: document.getElementById('card-set').value.trim(),
    number: document.getElementById('card-number').value.trim(),
    rarity: document.getElementById('card-rarity').value,
    condition: document.getElementById('card-condition').value,
    quantity: Math.max(1, parseInt(document.getElementById('card-quantity').value) || 1),
    purchasePrice: parseFloat(document.getElementById('card-purchase-price').value) || 0,
    value: parseFloat(value) || 0,
    imageUrl: document.getElementById('card-image-url').value,
    notes: document.getElementById('card-notes').value.trim(),
  };

  const category = document.getElementById('card-category').value;
  const existingId = document.getElementById('card-id').value;

  if (existingId) {
    Storage.updateCard(category, existingId, cardData);
  } else {
    Storage.addCard(category, cardData);
  }

  bootstrap.Modal.getInstance(document.getElementById('addCardModal')).hide();
  renderCollection(category);
  refreshDashboard();
}

document.getElementById('btn-save-card').addEventListener('click', saveCard);

// === Card Detail Modal ===
function showCardDetail(category, cardId) {
  const cards = Storage.getCollection(category);
  const card = cards.find(c => c.id === cardId);
  if (!card) return;

  const totalVal = (parseFloat(card.value) || 0) * (parseInt(card.quantity) || 1);
  const purchaseTotal = (parseFloat(card.purchasePrice) || 0) * (parseInt(card.quantity) || 1);
  const profitLoss = purchaseTotal > 0 ? totalVal - purchaseTotal : null;

  document.getElementById('cardDetailTitle').textContent = card.name;
  document.getElementById('cardDetailBody').innerHTML = `
    ${card.imageUrl
      ? `<img src="${escapeAttr(card.imageUrl)}" class="detail-img mb-3 img-fluid" alt="${escapeAttr(card.name)}">`
      : `<div class="no-image mb-3" style="height:150px;border-radius:8px;"><i class="bi bi-image"></i></div>`
    }
    <dl class="detail-info row mb-0">
      <dt class="col-5">Set</dt><dd class="col-7">${escapeHtml(card.set || '-')}</dd>
      <dt class="col-5">Number</dt><dd class="col-7">${escapeHtml(card.number || '-')}</dd>
      <dt class="col-5">Rarity</dt><dd class="col-7">${card.rarity ? `<span class="badge badge-rarity ${getRarityClass(card.rarity)}">${escapeHtml(card.rarity)}</span>` : '-'}</dd>
      <dt class="col-5">Condition</dt><dd class="col-7">${escapeHtml(card.condition || '-')}</dd>
      <dt class="col-5">Quantity</dt><dd class="col-7">${card.quantity || 1}</dd>
      <dt class="col-5">Purchase Price</dt><dd class="col-7">${card.purchasePrice ? formatCurrency(card.purchasePrice) + ' each' : '-'}</dd>
      <dt class="col-5">Current Value</dt><dd class="col-7 text-success fw-bold">${formatCurrency(card.value || 0)} each</dd>
      <dt class="col-5">Total Value</dt><dd class="col-7 text-success fw-bold">${formatCurrency(totalVal)}</dd>
      ${profitLoss !== null ? `
        <dt class="col-5">Profit/Loss</dt>
        <dd class="col-7 ${profitLoss >= 0 ? 'profit' : 'loss'} fw-bold">
          ${profitLoss >= 0 ? '+' : ''}${formatCurrency(profitLoss)}
        </dd>
      ` : ''}
      ${card.notes ? `<dt class="col-5">Notes</dt><dd class="col-7">${escapeHtml(card.notes)}</dd>` : ''}
      <dt class="col-5">Added</dt><dd class="col-7 text-muted">${formatDate(card.addedAt)}</dd>
    </dl>
  `;

  // Footer buttons use data attributes
  document.getElementById('cardDetailFooter').innerHTML = `
    <button class="btn btn-outline-danger btn-sm" data-action="delete" data-cat="${escapeAttr(category)}" data-id="${escapeAttr(card.id)}">
      <i class="bi bi-trash me-1"></i>Delete
    </button>
    <button class="btn btn-outline-primary btn-sm" data-action="edit" data-cat="${escapeAttr(category)}" data-id="${escapeAttr(card.id)}">
      <i class="bi bi-pencil me-1"></i>Edit
    </button>
  `;

  new bootstrap.Modal(document.getElementById('cardDetailModal')).show();
}

// Detail modal footer event delegation
document.getElementById('cardDetailFooter').addEventListener('click', (e) => {
  const btn = e.target.closest('[data-action]');
  if (!btn) return;

  const action = btn.getAttribute('data-action');
  const category = btn.getAttribute('data-cat');
  const cardId = btn.getAttribute('data-id');

  if (action === 'edit') {
    const cards = Storage.getCollection(category);
    const card = cards.find(c => c.id === cardId);
    if (!card) return;
    bootstrap.Modal.getInstance(document.getElementById('cardDetailModal')).hide();
    setTimeout(() => openAddCardModal(category, { ...card }), 300);
  } else if (action === 'delete') {
    bootstrap.Modal.getInstance(document.getElementById('cardDetailModal')).hide();
    setTimeout(() => confirmDeleteCard(category, cardId), 300);
  }
});

function confirmDeleteCard(category, cardId) {
  const modal = new bootstrap.Modal(document.getElementById('confirmDeleteModal'));
  const btn = document.getElementById('confirmDeleteBtn');

  const newBtn = btn.cloneNode(true);
  btn.parentNode.replaceChild(newBtn, btn);
  newBtn.id = 'confirmDeleteBtn';

  newBtn.addEventListener('click', () => {
    Storage.deleteCard(category, cardId);
    modal.hide();
    renderCollection(category);
    refreshDashboard();
  });

  modal.show();
}

// === Card Lookup - Pokemon ===
let pokemonSetsLoaded = false;

async function loadPokemonSets() {
  if (pokemonSetsLoaded) return;
  try {
    const sets = await CardAPI.getPokemonSets();
    const select = document.getElementById('pokemon-set-filter');
    sets.forEach(s => {
      const opt = document.createElement('option');
      opt.value = s.id;
      opt.textContent = `${s.name} (${s.series})`;
      select.appendChild(opt);
    });
    pokemonSetsLoaded = true;
  } catch { /* sets filter unavailable */ }
}

async function searchPokemonCards() {
  const query = document.getElementById('pokemon-search-input').value.trim();
  if (!query) return;

  const setFilter = document.getElementById('pokemon-set-filter').value;
  const statusEl = document.getElementById('pokemon-search-status');
  const resultsEl = document.getElementById('pokemon-search-results');

  statusEl.innerHTML = '<span class="spinner-search me-2"></span>Searching...';
  resultsEl.innerHTML = '';

  try {
    const cards = await CardAPI.searchPokemon(query, setFilter);
    searchResultCache.pokemon = cards.map(card => ({
      name: card.name,
      set: card.set,
      number: card.number,
      rarity: card.rarity,
      imageUrl: card.imageUrl,
      value: CardAPI.getBestPokemonPrice(card.prices) || 0,
    }));

    if (cards.length === 0) {
      statusEl.innerHTML = '<span class="text-warning">No cards found. Try a different search.</span>';
      return;
    }

    statusEl.innerHTML = `<span class="text-success">Found ${cards.length} card(s)</span>`;

    resultsEl.innerHTML = cards.map((card, i) => {
      const price = CardAPI.getBestPokemonPrice(card.prices);
      const priceDisplay = price ? formatCurrency(price) : 'N/A';

      return `
        <div class="col-6 col-md-4 col-lg-3 col-xl-2">
          <div class="search-card">
            ${card.imageUrl
              ? `<img src="${escapeAttr(card.imageUrl)}" class="card-img-top" alt="${escapeAttr(card.name)}" loading="lazy">`
              : `<div class="no-image"><i class="bi bi-image"></i></div>`
            }
            <div class="card-body">
              <div class="fw-bold text-truncate" title="${escapeAttr(card.name)}">${escapeHtml(card.name)}</div>
              <div class="text-muted small">${escapeHtml(card.set)} #${escapeHtml(card.number)}</div>
              ${card.rarity ? `<span class="badge badge-rarity ${getRarityClass(card.rarity)} mb-1">${escapeHtml(card.rarity)}</span>` : ''}
              <div class="price-tag">${priceDisplay}</div>
              <button class="btn btn-sm btn-outline-warning mt-2 w-100 btn-add-to-collection"
                      data-search-add="${i}" data-search-cat="pokemon">
                <i class="bi bi-plus-lg me-1"></i>Add
              </button>
            </div>
          </div>
        </div>
      `;
    }).join('');
  } catch {
    statusEl.innerHTML = '<span class="text-danger">Search failed. Please try again.</span>';
  }
}

document.getElementById('btn-search-pokemon').addEventListener('click', searchPokemonCards);
document.getElementById('pokemon-search-input').addEventListener('keydown', (e) => {
  if (e.key === 'Enter') searchPokemonCards();
});

// === Card Lookup - One Piece ===
async function searchOnePieceCards() {
  const query = document.getElementById('onepiece-search-input').value.trim();
  if (!query) return;

  const statusEl = document.getElementById('onepiece-search-status');
  const resultsEl = document.getElementById('onepiece-search-results');

  statusEl.innerHTML = '<span class="spinner-search me-2"></span>Searching...';
  resultsEl.innerHTML = '';

  try {
    const cards = await CardAPI.searchOnePiece(query);
    searchResultCache.onepiece = cards.map(card => ({
      name: card.name,
      set: card.set || '',
      number: card.number || '',
      rarity: card.rarity || '',
      imageUrl: card.imageUrl || '',
      value: 0,
    }));

    if (cards.length === 0) {
      statusEl.innerHTML = `
        <span class="text-warning">No results from API. You can add One Piece cards manually.</span>
        <button class="btn btn-sm btn-outline-danger ms-2" data-manual-add="onepiece" data-manual-name="${escapeAttr(query)}">
          <i class="bi bi-plus-lg me-1"></i>Add Manually
        </button>
      `;
      return;
    }

    statusEl.innerHTML = `<span class="text-success">Found ${cards.length} card(s)</span>`;

    resultsEl.innerHTML = cards.map((card, i) => `
      <div class="col-6 col-md-4 col-lg-3 col-xl-2">
        <div class="search-card">
          ${card.imageUrl
            ? `<img src="${escapeAttr(card.imageUrl)}" class="card-img-top" alt="${escapeAttr(card.name)}" loading="lazy">`
            : `<div class="no-image"><i class="bi bi-image"></i></div>`
          }
          <div class="card-body">
            <div class="fw-bold text-truncate" title="${escapeAttr(card.name)}">${escapeHtml(card.name)}</div>
            <div class="text-muted small">${escapeHtml(card.set || '')} ${card.number ? '#' + escapeHtml(card.number) : ''}</div>
            ${card.rarity ? `<span class="badge badge-rarity ${getRarityClass(card.rarity)} mb-1">${escapeHtml(card.rarity)}</span>` : ''}
            <button class="btn btn-sm btn-outline-danger mt-2 w-100 btn-add-to-collection"
                    data-search-add="${i}" data-search-cat="onepiece">
              <i class="bi bi-plus-lg me-1"></i>Add
            </button>
          </div>
        </div>
      </div>
    `).join('');
  } catch {
    statusEl.innerHTML = `
      <span class="text-warning">API unavailable. Add One Piece cards manually.</span>
      <button class="btn btn-sm btn-outline-danger ms-2" data-manual-add="onepiece" data-manual-name="${escapeAttr(query)}">
        <i class="bi bi-plus-lg me-1"></i>Add Manually
      </button>
    `;
  }
}

document.getElementById('btn-search-onepiece').addEventListener('click', searchOnePieceCards);
document.getElementById('onepiece-search-input').addEventListener('keydown', (e) => {
  if (e.key === 'Enter') searchOnePieceCards();
});

// === Card Lookup - Invincible ===
function searchInvincibleCards() {
  const query = document.getElementById('invincible-search-input').value.trim();
  if (!query) return;

  const statusEl = document.getElementById('invincible-search-status');
  const resultsEl = document.getElementById('invincible-search-results');

  const cards = CardAPI.searchInvincible(query);
  searchResultCache.invincible = cards.map(card => ({
    name: card.name,
    set: card.set,
    number: '',
    rarity: card.rarity,
    imageUrl: card.imageUrl || '',
    value: card.estimatedValue || 0,
  }));

  if (cards.length === 0) {
    statusEl.innerHTML = `
      <span class="text-warning">No matches found. Invincible TCG is very new - add your card manually.</span>
      <button class="btn btn-sm btn-outline-info ms-2" data-manual-add="invincible" data-manual-name="${escapeAttr(query)}">
        <i class="bi bi-plus-lg me-1"></i>Add Manually
      </button>
    `;
    resultsEl.innerHTML = '';
    return;
  }

  statusEl.innerHTML = `<span class="text-success">Found ${cards.length} card(s) in reference list</span>`;

  resultsEl.innerHTML = cards.map((card, i) => `
    <div class="col-6 col-md-4 col-lg-3 col-xl-2">
      <div class="search-card">
        ${card.imageUrl
          ? `<img src="${escapeAttr(card.imageUrl)}" class="card-img-top" alt="${escapeAttr(card.name)}" loading="lazy">`
          : `<div class="no-image"><i class="bi bi-shield-fill" style="color:#00b4d8;"></i></div>`
        }
        <div class="card-body">
          <div class="fw-bold text-truncate" title="${escapeAttr(card.name)}">${escapeHtml(card.name)}</div>
          <div class="text-muted small">${escapeHtml(card.set)}</div>
          ${card.rarity ? `<span class="badge badge-rarity ${getRarityClass(card.rarity)} mb-1">${escapeHtml(card.rarity)}</span>` : ''}
          <div class="price-tag">${card.estimatedValue ? formatCurrency(card.estimatedValue) : 'N/A'}</div>
          <button class="btn btn-sm btn-outline-info mt-2 w-100 btn-add-to-collection"
                  data-search-add="${i}" data-search-cat="invincible">
            <i class="bi bi-plus-lg me-1"></i>Add
          </button>
        </div>
      </div>
    </div>
  `).join('');
}

document.getElementById('btn-search-invincible').addEventListener('click', searchInvincibleCards);
document.getElementById('invincible-search-input').addEventListener('keydown', (e) => {
  if (e.key === 'Enter') searchInvincibleCards();
});

// === Settings: Export / Import / Clear ===
document.getElementById('btn-export').addEventListener('click', () => {
  const data = Storage.exportData();
  const blob = new Blob([data], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `cardvault-backup-${new Date().toISOString().slice(0, 10)}.json`;
  a.click();
  URL.revokeObjectURL(url);
});

document.getElementById('btn-import').addEventListener('click', () => {
  const fileInput = document.getElementById('import-file');
  const file = fileInput.files[0];
  if (!file) { alert('Please select a JSON file first.'); return; }

  const reader = new FileReader();
  reader.onload = (e) => {
    try {
      Storage.importData(e.target.result);
      alert('Collection imported successfully!');
      refreshDashboard();
    } catch {
      alert('Invalid file format. Please use a Card Vault export file.');
    }
  };
  reader.readAsText(file);
});

document.getElementById('btn-clear-all').addEventListener('click', () => {
  if (confirm('Are you sure you want to delete ALL your card data? This cannot be undone!')) {
    if (confirm('Really? This will permanently erase your entire collection.')) {
      localStorage.removeItem('cardvault_collection');
      refreshDashboard();
      alert('All data cleared.');
    }
  }
});

// === Utility Functions ===
function formatCurrency(amount) {
  return '$' + (parseFloat(amount) || 0).toFixed(2);
}

function formatDate(isoString) {
  if (!isoString) return '-';
  const d = new Date(isoString);
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

function escapeHtml(str) {
  if (!str) return '';
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}

function escapeAttr(str) {
  if (!str) return '';
  return String(str).replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/'/g, '&#39;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function getRarityClass(rarity) {
  if (!rarity) return '';
  const r = rarity.toLowerCase();
  if (r.includes('secret')) return 'rarity-secret';
  if (r.includes('ultra')) return 'rarity-ultra';
  if (r.includes('full art')) return 'rarity-full';
  if (r.includes('alt art') || r.includes('alternate')) return 'rarity-alt';
  if (r.includes('special')) return 'rarity-special';
  if (r.includes('holo')) return 'rarity-holo';
  if (r.includes('rare')) return 'rarity-rare';
  if (r.includes('uncommon')) return 'rarity-uncommon';
  if (r.includes('promo')) return 'rarity-promo';
  return 'rarity-common';
}

function getCategoryIcon(category) {
  const icons = {
    pokemon: '<i class="bi bi-lightning-fill text-warning me-1"></i>',
    onepiece: '<i class="bi bi-tsunami text-danger me-1"></i>',
    invincible: '<i class="bi bi-shield-fill text-info me-1"></i>',
  };
  return icons[category] || '';
}

function getCategoryBadge(category) {
  const badges = {
    pokemon: '<span class="badge bg-warning text-dark">Pokemon</span>',
    onepiece: '<span class="badge bg-danger">One Piece</span>',
    invincible: '<span class="badge bg-info">Invincible</span>',
  };
  return badges[category] || '';
}

// === Init ===
document.addEventListener('DOMContentLoaded', () => {
  refreshDashboard();
  loadPokemonSets();
});
