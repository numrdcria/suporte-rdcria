const loginSection = document.getElementById('loginSection');
const panelSection = document.getElementById('panelSection');
const loginForm = document.getElementById('loginForm');
const loginError = document.getElementById('loginError');
const logoutBtn = document.getElementById('logoutBtn');
const refreshBtn = document.getElementById('refreshBtn');
const searchInput = document.getElementById('searchInput');
const statusFilter = document.getElementById('statusFilter');
const ticketsList = document.getElementById('ticketsList');
const ticketDetail = document.getElementById('ticketDetail');
const servicesEditor = document.getElementById('servicesEditor');
const saveServicesBtn = document.getElementById('saveServicesBtn');
const employeeForm = document.getElementById('employeeForm');
const employeeNameInput = document.getElementById('employeeNameInput');
const employeeRoster = document.getElementById('employeeRoster');
const timeclockHistory = document.getElementById('timeclockHistory');

const statTotal = document.getElementById('statTotal');
const statOpen = document.getElementById('statOpen');
const statProgress = document.getElementById('statProgress');
const statResolved = document.getElementById('statResolved');
const clockEmployees = document.getElementById('clockEmployees');
const clockWorking = document.getElementById('clockWorking');
const clockClosedToday = document.getElementById('clockClosedToday');
const clockHoursToday = document.getElementById('clockHoursToday');

const state = {
  tickets: [],
  services: [],
  selectedProtocol: '',
  selectedTicket: null,
  timeclock: {
    employees: [],
    recentShifts: [],
    summary: {}
  }
};

function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

function formatDate(value) {
  if (!value) return '';
  try {
    return new Intl.DateTimeFormat('pt-BR', {
      dateStyle: 'short',
      timeStyle: 'short'
    }).format(new Date(value));
  } catch {
    return value;
  }
}

function formatDuration(value) {
  const minutes = Math.max(0, Math.round(Number(value) || 0));
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;

  if (!hours) return `${minutes} min`;
  if (!rest) return `${hours}h`;
  return `${hours}h ${rest}min`;
}

function pillClass(status) {
  const normalized = String(status || '').toLowerCase();
  if (normalized.includes('resolvido')) return 'success';
  if (normalized.includes('aguardando')) return 'warning';
  if (normalized.includes('atendimento')) return 'warning';
  return 'success';
}

async function apiFetch(url, options = {}) {
  const config = { ...options, headers: { ...(options.headers || {}) } };

  if (config.body && !config.headers['Content-Type']) {
    config.headers['Content-Type'] = 'application/json';
  }

  const response = await fetch(url, config);
  const data = await response.json().catch(() => ({}));

  if (!response.ok) {
    if (response.status === 401) {
      showLogin();
    }
    throw new Error(data.error || 'Não foi possível concluir a ação.');
  }

  return data;
}

function showLogin() {
  loginSection.classList.remove('hidden');
  panelSection.classList.add('hidden');
}

function showPanel() {
  loginSection.classList.add('hidden');
  panelSection.classList.remove('hidden');
  loginError.classList.add('hidden');
}

function renderStats(stats) {
  statTotal.textContent = String(stats.total || 0);
  statOpen.textContent = String(stats.open || 0);
  statProgress.textContent = String(stats.inProgress || 0);
  statResolved.textContent = String(stats.resolved || 0);
}

function renderServicesEditor() {
  servicesEditor.innerHTML = state.services.map((service, index) => `
    <article class="service-editor-card" data-service-index="${index}">
      <h4>${escapeHtml(service.name)}</h4>
      <div class="service-fields">
        <label>
          Situação
          <select name="status">
            <option value="operational" ${service.status === 'operational' ? 'selected' : ''}>Estável</option>
            <option value="maintenance" ${service.status === 'maintenance' ? 'selected' : ''}>Manutenção</option>
            <option value="degraded" ${service.status === 'degraded' ? 'selected' : ''}>Instabilidade</option>
          </select>
        </label>
        <label>
          Rótulo
          <input type="text" name="label" value="${escapeHtml(service.label)}" />
        </label>
        <label>
          Mensagem
          <textarea name="message" rows="3">${escapeHtml(service.message)}</textarea>
        </label>
      </div>
    </article>
  `).join('');
}

function renderTicketPlaceholder(message = 'Selecione um atendimento para visualizar a conversa e responder ao cliente.') {
  ticketDetail.className = 'ticket-detail empty-state';
  ticketDetail.textContent = message;
}

function renderTickets() {
  if (!state.tickets.length) {
    ticketsList.innerHTML = '<div class="ticket-card">Nenhum atendimento encontrado.</div>';
    if (!state.selectedProtocol) {
      renderTicketPlaceholder();
    }
    return;
  }

  ticketsList.innerHTML = state.tickets.map((ticket) => `
    <article class="ticket-card ${ticket.protocol === state.selectedProtocol ? 'active' : ''}" data-ticket="${escapeHtml(ticket.protocol)}">
      <div class="ticket-top">
        <strong>${escapeHtml(ticket.protocol)}</strong>
        <span class="pill ${pillClass(ticket.status)}">${escapeHtml(ticket.status)}</span>
      </div>
      <div class="ticket-subject">${escapeHtml(ticket.service || 'Streaming')}</div>
      <div class="ticket-line">${escapeHtml(ticket.customer.name)} • ${escapeHtml(ticket.customer.email)}</div>
      <div class="ticket-meta">
        <small>${formatDate(ticket.updatedAt)}</small>
        <small>${escapeHtml(ticket.device || 'Sem dispositivo')}</small>
      </div>
    </article>
  `).join('');
}

function renderTicketDetail(ticket) {
  state.selectedTicket = ticket;
  ticketDetail.classList.remove('empty-state');

  const messages = (ticket.messages || []).map((message) => {
    const kindClass = message.public ? (message.authorType === 'customer' ? 'customer' : 'admin') : 'internal';
    return `
      <article class="message-card ${kindClass}">
        <div class="message-meta">
          <strong>${escapeHtml(message.authorType === 'customer' ? ticket.customer.name : message.authorName || 'Suporte do RDCRIA')}</strong>
          <span>${formatDate(message.at)}</span>
          ${message.public ? '<span class="pill success">Público</span>' : '<span class="pill warning">Interna</span>'}
        </div>
        <p>${escapeHtml(message.text)}</p>
      </article>
    `;
  }).join('');

  ticketDetail.innerHTML = `
    <div class="ticket-detail-body">
      <div class="ticket-head">
        <div>
          <span class="eyebrow">Conversa selecionada</span>
          <h2>${escapeHtml(ticket.protocol)}</h2>
          <p>${escapeHtml(ticket.customer.name)} • ${escapeHtml(ticket.customer.email)}</p>
        </div>
        <span class="pill ${pillClass(ticket.status)}">${escapeHtml(ticket.status)}</span>
      </div>

      <div class="meta-grid">
        <article class="meta-card">
          <strong>Área</strong>
          <span>${escapeHtml(ticket.service || 'Streaming')}</span>
        </article>
        <article class="meta-card">
          <strong>Dispositivo</strong>
          <span>${escapeHtml(ticket.device || 'Não informado')}</span>
        </article>
        <article class="meta-card">
          <strong>Criado em</strong>
          <span>${formatDate(ticket.createdAt)}</span>
        </article>
        <article class="meta-card">
          <strong>Atualizado em</strong>
          <span>${formatDate(ticket.updatedAt)}</span>
        </article>
      </div>

      <section class="settings-card">
        <form id="settingsForm" class="settings-form">
          <div class="settings-grid">
            <label>
              Status
              <select name="status">
                <option value="Aberto" ${ticket.status === 'Aberto' ? 'selected' : ''}>Aberto</option>
                <option value="Em atendimento" ${ticket.status === 'Em atendimento' ? 'selected' : ''}>Em atendimento</option>
                <option value="Aguardando cliente" ${ticket.status === 'Aguardando cliente' ? 'selected' : ''}>Aguardando cliente</option>
                <option value="Resolvido" ${ticket.status === 'Resolvido' ? 'selected' : ''}>Resolvido</option>
              </select>
            </label>

            <label>
              Responsável
              <input type="text" name="assignedTo" value="${escapeHtml(ticket.assignedTo || '')}" placeholder="Nome do responsável" />
            </label>
          </div>

          <label>
            Observações internas
            <textarea name="adminNotes" rows="4" placeholder="Notas visíveis apenas no painel">${escapeHtml(ticket.adminNotes || '')}</textarea>
          </label>

          <div class="header-actions">
            <button type="submit" class="button primary">Salvar dados</button>
            <button type="button" id="refreshTicketBtn" class="button ghost">Atualizar conversa</button>
          </div>
        </form>
      </section>

      <section>
        <div class="thread">${messages || '<article class="message-card admin"><p>Sem mensagens nesta conversa.</p></article>'}</div>
      </section>

      <section class="compose-card">
        <form id="replyForm" class="compose-form">
          <label>
            Mensagem
            <textarea name="message" rows="5" placeholder="Digite a resposta..." required></textarea>
          </label>

          <div class="compose-row">
            <label class="toggle">
              <input type="checkbox" name="isPublic" checked />
              Visível para o cliente
            </label>

            <div class="header-actions">
              <button type="submit" class="button primary">Enviar mensagem</button>
            </div>
          </div>
        </form>
      </section>
    </div>
  `;

  const settingsForm = document.getElementById('settingsForm');
  const replyForm = document.getElementById('replyForm');
  const refreshTicketBtn = document.getElementById('refreshTicketBtn');

  settingsForm.addEventListener('submit', async (event) => {
    event.preventDefault();
    const saveBtn = settingsForm.querySelector('button[type="submit"]');
    saveBtn.disabled = true;
    saveBtn.textContent = 'Salvando...';

    try {
      const payload = Object.fromEntries(new FormData(settingsForm).entries());
      await apiFetch(`/api/admin/tickets/${encodeURIComponent(ticket.protocol)}`, {
        method: 'PATCH',
        body: JSON.stringify(payload)
      });
      await loadDashboard();
      await openTicket(ticket.protocol);
    } catch (error) {
      alert(error.message);
    } finally {
      saveBtn.disabled = false;
      saveBtn.textContent = 'Salvar dados';
    }
  });

  refreshTicketBtn.addEventListener('click', async () => {
    await loadDashboard();
    await openTicket(ticket.protocol);
  });

  replyForm.addEventListener('submit', async (event) => {
    event.preventDefault();
    const submitBtn = replyForm.querySelector('button[type="submit"]');
    const formData = new FormData(replyForm);
    const message = String(formData.get('message') || '').trim();
    const isPublic = Boolean(formData.get('isPublic'));

    if (!message) return;

    submitBtn.disabled = true;
    submitBtn.textContent = 'Enviando...';

    try {
      const settingsData = new FormData(settingsForm);
      await apiFetch(`/api/admin/tickets/${encodeURIComponent(ticket.protocol)}/message`, {
        method: 'POST',
        body: JSON.stringify({
          message,
          public: isPublic,
          status: settingsData.get('status')
        })
      });
      replyForm.reset();
      replyForm.querySelector('[name="isPublic"]').checked = true;
      await loadDashboard();
      await openTicket(ticket.protocol);
    } catch (error) {
      alert(error.message);
    } finally {
      submitBtn.disabled = false;
      submitBtn.textContent = 'Enviar mensagem';
    }
  });
}

function renderTimeclockSummary(summary = {}) {
  clockEmployees.textContent = String(summary.totalEmployees || 0);
  clockWorking.textContent = String(summary.workingNow || 0);
  clockClosedToday.textContent = String(summary.closedToday || 0);
  clockHoursToday.textContent = formatDuration(summary.totalWorkedTodayMinutes || 0);
}

function renderEmployeeRoster() {
  const employees = state.timeclock.employees || [];

  if (!employees.length) {
    employeeRoster.innerHTML = '<div class="empty-block">Cadastre o primeiro funcionário para começar a registrar entrada e saída.</div>';
    return;
  }

  employeeRoster.innerHTML = employees.map((employee) => {
    const isWorking = employee.status === 'working' && employee.activeShift;
    const statusText = isWorking
      ? `Entrada registrada em ${formatDate(employee.activeShift.clockInAt)}`
      : employee.lastShift
        ? `Última movimentação em ${formatDate(employee.lastShift.clockOutAt || employee.lastShift.clockInAt)}`
        : 'Sem registros de ponto';

    const lastBadge = isWorking
      ? `<span class="soft-badge">Em aberto: ${formatDuration(employee.activeShift.workedMinutes || 0)}</span>`
      : employee.lastShift
        ? `<span class="soft-badge">Último total: ${formatDuration(employee.lastShift.workedMinutes || 0)}</span>`
        : '<span class="soft-badge">Sem histórico</span>';

    return `
      <article class="employee-card">
        <div class="employee-top">
          <div>
            <strong>${escapeHtml(employee.name)}</strong>
            <p>${escapeHtml(statusText)}</p>
          </div>
          <span class="pill ${isWorking ? 'success' : 'warning'}">${isWorking ? 'Em expediente' : 'Fora do expediente'}</span>
        </div>

        <div class="employee-meta">
          <span class="soft-badge">Hoje: ${formatDuration(employee.workedTodayMinutes || 0)}</span>
          ${lastBadge}
        </div>

        <div class="employee-actions">
          <button type="button" class="button ${isWorking ? 'ghost' : 'primary'}" data-punch="in" data-employee-id="${escapeHtml(employee.id)}" ${isWorking ? 'disabled' : ''}>Registrar entrada</button>
          <button type="button" class="button ${isWorking ? 'danger' : 'ghost'}" data-punch="out" data-employee-id="${escapeHtml(employee.id)}" ${isWorking ? '' : 'disabled'}>Registrar saída</button>
        </div>
      </article>
    `;
  }).join('');
}

function renderTimeclockHistory() {
  const shifts = state.timeclock.recentShifts || [];

  if (!shifts.length) {
    timeclockHistory.innerHTML = '<div class="empty-block">As movimentações de ponto vão aparecer aqui.</div>';
    return;
  }

  timeclockHistory.innerHTML = shifts.map((shift) => `
    <article class="shift-card">
      <div class="shift-head">
        <div>
          <strong>${escapeHtml(shift.employeeName)}</strong>
          <small>${shift.clockOutAt ? 'Expediente finalizado' : 'Expediente em aberto'}</small>
        </div>
        <span class="pill ${shift.clockOutAt ? 'success' : 'warning'}">${shift.clockOutAt ? 'Fechado' : 'Aberto'}</span>
      </div>

      <div class="shift-grid">
        <div>
          <span>Entrada</span>
          <strong>${escapeHtml(formatDate(shift.clockInAt))}</strong>
        </div>
        <div>
          <span>Saída</span>
          <strong>${shift.clockOutAt ? escapeHtml(formatDate(shift.clockOutAt)) : 'Em andamento'}</strong>
        </div>
        <div>
          <span>Total</span>
          <strong>${escapeHtml(formatDuration(shift.workedMinutes || 0))}</strong>
        </div>
      </div>
    </article>
  `).join('');
}

function renderTimeclock() {
  renderTimeclockSummary(state.timeclock.summary || {});
  renderEmployeeRoster();
  renderTimeclockHistory();
}

async function openTicket(protocol) {
  state.selectedProtocol = protocol;
  renderTickets();

  const data = await apiFetch(`/api/admin/tickets/${encodeURIComponent(protocol)}`, { method: 'GET' });
  renderTicketDetail(data.ticket);
}

async function loadTickets() {
  const query = new URLSearchParams({
    status: statusFilter.value || 'Todos',
    search: searchInput.value || ''
  }).toString();

  const data = await apiFetch(`/api/admin/tickets?${query}`, { method: 'GET' });
  state.tickets = data.tickets || [];
  renderTickets();

  if (state.selectedProtocol && !state.tickets.some((item) => item.protocol === state.selectedProtocol)) {
    state.selectedProtocol = '';
    state.selectedTicket = null;
    renderTicketPlaceholder();
  }
}

async function loadDashboard() {
  const data = await apiFetch('/api/admin/dashboard', { method: 'GET' });
  renderStats(data.stats || {});
  state.services = data.services || [];
  renderServicesEditor();
  await loadTickets();
}

async function loadTimeclock() {
  const data = await apiFetch('/api/admin/timeclock', { method: 'GET' });
  state.timeclock = {
    employees: data.employees || [],
    recentShifts: data.recentShifts || [],
    summary: data.summary || {}
  };
  renderTimeclock();
}

async function loadAdminData() {
  await Promise.all([loadDashboard(), loadTimeclock()]);
}

loginForm?.addEventListener('submit', async (event) => {
  event.preventDefault();
  const button = loginForm.querySelector('button[type="submit"]');
  const payload = Object.fromEntries(new FormData(loginForm).entries());

  button.disabled = true;
  button.textContent = 'Entrando...';

  try {
    await apiFetch('/api/admin/login', {
      method: 'POST',
      body: JSON.stringify(payload)
    });
    showPanel();
    loginForm.reset();
    await loadAdminData();
  } catch (error) {
    loginError.textContent = error.message;
    loginError.classList.remove('hidden');
  } finally {
    button.disabled = false;
    button.textContent = 'Entrar';
  }
});

logoutBtn?.addEventListener('click', async () => {
  try {
    await apiFetch('/api/admin/logout', { method: 'POST' });
  } catch {}
  showLogin();
  state.selectedProtocol = '';
  state.selectedTicket = null;
  state.timeclock = { employees: [], recentShifts: [], summary: {} };
  renderTicketPlaceholder();
  renderTimeclock();
});

ticketsList?.addEventListener('click', async (event) => {
  const card = event.target.closest('[data-ticket]');
  if (!card) return;
  await openTicket(card.getAttribute('data-ticket'));
});

refreshBtn?.addEventListener('click', async () => {
  refreshBtn.disabled = true;
  const original = refreshBtn.textContent;
  refreshBtn.textContent = 'Atualizando...';

  try {
    await loadAdminData();
    if (state.selectedProtocol) {
      await openTicket(state.selectedProtocol);
    }
  } finally {
    refreshBtn.disabled = false;
    refreshBtn.textContent = original;
  }
});

statusFilter?.addEventListener('change', loadTickets);
searchInput?.addEventListener('input', debounce(loadTickets, 220));

saveServicesBtn?.addEventListener('click', async () => {
  const cards = [...servicesEditor.querySelectorAll('[data-service-index]')];
  const services = cards.map((card, index) => ({
    id: state.services[index].id,
    name: state.services[index].name,
    status: card.querySelector('[name="status"]').value,
    label: card.querySelector('[name="label"]').value,
    message: card.querySelector('[name="message"]').value
  }));

  saveServicesBtn.disabled = true;
  saveServicesBtn.textContent = 'Salvando...';

  try {
    const data = await apiFetch('/api/admin/services', {
      method: 'PATCH',
      body: JSON.stringify({ services })
    });
    state.services = data.services || [];
    renderServicesEditor();
  } catch (error) {
    alert(error.message);
  } finally {
    saveServicesBtn.disabled = false;
    saveServicesBtn.textContent = 'Salvar status';
  }
});

employeeForm?.addEventListener('submit', async (event) => {
  event.preventDefault();
  const button = employeeForm.querySelector('button[type="submit"]');
  const name = String(employeeNameInput?.value || '').trim();

  if (!name) {
    employeeNameInput?.focus();
    return;
  }

  button.disabled = true;
  button.textContent = 'Salvando...';

  try {
    await apiFetch('/api/admin/timeclock/employees', {
      method: 'POST',
      body: JSON.stringify({ name })
    });
    employeeForm.reset();
    await loadTimeclock();
  } catch (error) {
    alert(error.message);
  } finally {
    button.disabled = false;
    button.textContent = 'Cadastrar';
  }
});

employeeRoster?.addEventListener('click', async (event) => {
  const button = event.target.closest('[data-punch]');
  if (!button) return;

  const employeeId = button.getAttribute('data-employee-id');
  const action = button.getAttribute('data-punch');
  const original = button.textContent;

  button.disabled = true;
  button.textContent = action === 'in' ? 'Registrando...' : 'Finalizando...';

  try {
    await apiFetch('/api/admin/timeclock/punch', {
      method: 'POST',
      body: JSON.stringify({ employeeId, action })
    });
    await loadTimeclock();
  } catch (error) {
    alert(error.message);
  } finally {
    button.disabled = false;
    button.textContent = original;
  }
});

function debounce(fn, delay = 250) {
  let timer;
  return (...args) => {
    clearTimeout(timer);
    timer = setTimeout(() => fn(...args), delay);
  };
}

async function bootstrap() {
  try {
    await apiFetch('/api/admin/me', { method: 'GET' });
    showPanel();
    await loadAdminData();
  } catch {
    showLogin();
    renderTicketPlaceholder();
    renderTimeclock();
  }
}

bootstrap();
