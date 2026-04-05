/**
 * Main application logic for Card Vault - Trading Card Tracker.
 */

let valueChart = null;

// === Page Navigation ===
document.querySelectorAll('[data-page]').forEach(link => {
  link.addEventListener('click', (e) => {
    e.preventDefault();
    const page = link.getAttribute('data-page');
    showPage(page);
  });
});

function showPage(page) {
  document.querySelectorAll('.page-content').forEach(p => p.classList.add('d-none'));
  document.getElementById('page-' + page).classList.remove('d-none');

  document.querySelectorAll('[data-page]').forEach(l => l.classList.remove('active'));
  const activeLink = document.querySelector(`[data-page="${page}"]`);
  if (activeLink) activeLink.classList.add('active');

  if (page === 'dashboard') refreshDashboard();
  if (['pokemon', 'onepiece', 'invincible'].includes(page)) renderCollection(page);
}

// === Lookup Tab Navigation ===
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
          labels: { color: '#ccc', padding: 15 }
        },
        tooltip: {
          callbacks: {
            label: (ctx) => hasData ? `${ctx.label}: ${formatCurrency(ctx.raw)}` : 'No data'
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
    const catIcon = getCategoryIcon(card.category);
    return `
      <div class="top-card-item">
        <div>
          <span class="text-muted me-2">#${i + 1}</span>
          ${catIcon}
          <strong>${escapeHtml(card.name)}</strong>
          <span class="text-muted ms-2">${escapeHtml(card.set || '')}</span>
        </div>
        <span class="fw-bold text-success">${formatCurrency(totalVal)}</span>
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
            <th>Set</th>
            <th>Value</th>
            <th>Added</th>
          </tr>
        </thead>
        <tbody>
          ${recent.map(card => `
            <tr>
              <td>${escapeHtml(card.name)}</td>
              <td>${getCategoryBadge(card.category)}</td>
              <td class="text-muted">${escapeHtml(card.set || '-')}</td>
              <td class="text-success fw-bold">${formatCurrency(parseFloat(card.value) || 0)}</td>
              <td class="text-muted">${formatDate(card.addedAt)}</td>
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
  const sortVal = document.getElementById('sort-' + category).value;

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
        <p>Click "Add Card" to start building your collection, or use Card Lookup to find and add cards.</p>
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
        <div class="collection-card" onclick="showCardDetail('${category}', '${card.id}')">
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

function filterCollection(category) {
  renderCollection(category);
}

function sortCards(cards, sortVal) {
  const sorted = [...cards];
  switch (sortVal) {
    case 'date-desc':
      sorted.sort((a, b) => new Date(b.addedAt) - new Date(a.addedAt));
      break;
    case 'date-asc':
      sorted.sort((a, b) => new Date(a.addedAt) - new Date(b.addedAt));
      break;
    case 'value-desc':
      sorted.sort((a, b) => ((parseFloat(b.value) || 0) * (parseInt(b.quantity) || 1)) -
                             ((parseFloat(a.value) || 0) * (parseInt(a.quantity) || 1)));
      break;
    case 'value-asc':
      sorted.sort((a, b) => ((parseFloat(a.value) || 0) * (parseInt(a.quantity) || 1)) -
                             ((parseFloat(b.value) || 0) * (parseInt(b.quantity) || 1)));
      break;
    case 'name-asc':
      sorted.sort((a, b) => (a.name || '').localeCompare(b.name || ''));
      break;
  }
  return sorted;
}

// === Add / Edit Card Modal ===
function openAddCardModal(category, prefill = {}) {
  document.getElementById('card-id').value = '';
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
  if (prefill.id) {
    document.getElementById('card-id').value = prefill.id;
  }

  new bootstrap.Modal(document.getElementById('addCardModal')).show();
}

function saveCard() {
  const name = document.getElementById('card-name').value.trim();
  const value = document.getElementById('card-value').value;

  if (!name) { alert('Please enter a card name.'); return; }
  if (!value || parseFloat(value) < 0) { alert('Please enter a valid current value.'); return; }

  const cardData = {
    name: name,
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

  document.getElementById('cardDetailFooter').innerHTML = `
    <button class="btn btn-outline-danger btn-sm" onclick="confirmDeleteCard('${category}', '${card.id}')">
      <i class="bi bi-trash me-1"></i>Delete
    </button>
    <button class="btn btn-outline-primary btn-sm" onclick="editCard('${category}', '${card.id}')">
      <i class="bi bi-pencil me-1"></i>Edit
    </button>
  `;

  new bootstrap.Modal(document.getElementById('cardDetailModal')).show();
}

function editCard(category, cardId) {
  const cards = Storage.getCollection(category);
  const card = cards.find(c => c.id === cardId);
  if (!card) return;

  bootstrap.Modal.getInstance(document.getElementById('cardDetailModal')).hide();
  setTimeout(() => openAddCardModal(category, { ...card }), 300);
}

function confirmDeleteCard(category, cardId) {
  bootstrap.Modal.getInstance(document.getElementById('cardDetailModal')).hide();

  setTimeout(() => {
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
  }, 300);
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
  } catch {
    // Silently fail - sets filter just won't be populated
  }
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

    if (cards.length === 0) {
      statusEl.innerHTML = '<span class="text-warning">No cards found. Try a different search.</span>';
      return;
    }

    statusEl.innerHTML = `<span class="text-success">Found ${cards.length} card(s)</span>`;

    resultsEl.innerHTML = cards.map(card => {
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
              <button class="btn btn-sm btn-outline-warning mt-2 w-100"
                      onclick='addFromSearch("pokemon", ${escapeJsonAttr(JSON.stringify({
                        name: card.name,
                        set: card.set,
                        number: card.number,
                        rarity: card.rarity,
                        imageUrl: card.imageUrl,
                        value: price || 0
                      }))})'>
                <i class="bi bi-plus-lg me-1"></i>Add to Collection
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

// Allow Enter key to trigger search
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

    if (cards.length === 0) {
      statusEl.innerHTML = `
        <span class="text-warning">No results from API. You can manually add One Piece cards to your collection.</span>
        <button class="btn btn-sm btn-outline-danger ms-2" onclick="openAddCardModal('onepiece', { name: '${escapeAttr(query)}' })">
          <i class="bi bi-plus-lg me-1"></i>Add Manually
        </button>
      `;
      return;
    }

    statusEl.innerHTML = `<span class="text-success">Found ${cards.length} card(s)</span>`;

    resultsEl.innerHTML = cards.map(card => `
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
            <button class="btn btn-sm btn-outline-danger mt-2 w-100"
                    onclick='addFromSearch("onepiece", ${escapeJsonAttr(JSON.stringify({
                      name: card.name,
                      set: card.set || '',
                      number: card.number || '',
                      rarity: card.rarity || '',
                      imageUrl: card.imageUrl || '',
                      value: 0
                    }))})'>
              <i class="bi bi-plus-lg me-1"></i>Add to Collection
            </button>
          </div>
        </div>
      </div>
    `).join('');
  } catch {
    statusEl.innerHTML = `
      <span class="text-warning">API unavailable. You can add One Piece cards manually.</span>
      <button class="btn btn-sm btn-outline-danger ms-2" onclick="openAddCardModal('onepiece', { name: '${escapeAttr(query)}' })">
        <i class="bi bi-plus-lg me-1"></i>Add Manually
      </button>
    `;
  }
}

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

  if (cards.length === 0) {
    statusEl.innerHTML = `
      <span class="text-warning">No matches in reference list. Invincible TCG is very new - add your card manually.</span>
      <button class="btn btn-sm btn-outline-info ms-2" onclick="openAddCardModal('invincible', { name: '${escapeAttr(query)}' })">
        <i class="bi bi-plus-lg me-1"></i>Add Manually
      </button>
    `;
    resultsEl.innerHTML = '';
    return;
  }

  statusEl.innerHTML = `<span class="text-success">Found ${cards.length} card(s) in reference list</span>`;

  resultsEl.innerHTML = cards.map(card => `
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
          <button class="btn btn-sm btn-outline-info mt-2 w-100"
                  onclick='addFromSearch("invincible", ${escapeJsonAttr(JSON.stringify({
                    name: card.name,
                    set: card.set,
                    number: '',
                    rarity: card.rarity,
                    imageUrl: card.imageUrl || '',
                    value: card.estimatedValue || 0
                  }))})'>
            <i class="bi bi-plus-lg me-1"></i>Add to Collection
          </button>
        </div>
      </div>
    </div>
  `).join('');
}

document.getElementById('invincible-search-input').addEventListener('keydown', (e) => {
  if (e.key === 'Enter') searchInvincibleCards();
});

// === Add from Search Results ===
function addFromSearch(category, cardData) {
  openAddCardModal(category, cardData);
}

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
  return str.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/'/g, '&#39;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function escapeJsonAttr(jsonStr) {
  return jsonStr.replace(/&/g, '&amp;').replace(/'/g, '&#39;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
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
  switch (category) {
    case 'pokemon': return '<i class="bi bi-lightning-fill text-warning me-1"></i>';
    case 'onepiece': return '<i class="bi bi-tsunami text-danger me-1"></i>';
    case 'invincible': return '<i class="bi bi-shield-fill text-info me-1"></i>';
    default: return '';
  }
}

function getCategoryBadge(category) {
  switch (category) {
    case 'pokemon': return '<span class="badge bg-warning text-dark">Pokemon</span>';
    case 'onepiece': return '<span class="badge bg-danger">One Piece</span>';
    case 'invincible': return '<span class="badge bg-info">Invincible</span>';
    default: return '';
  }
}

// === Init ===
document.addEventListener('DOMContentLoaded', () => {
  refreshDashboard();
  loadPokemonSets();
});
