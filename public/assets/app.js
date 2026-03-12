const servicesGrid = document.getElementById('servicesGrid');
const startForm = document.getElementById('startForm');
const resumeForm = document.getElementById('resumeForm');
const startFeedback = document.getElementById('startFeedback');
const resumeFeedback = document.getElementById('resumeFeedback');
const chatPanel = document.getElementById('chatPanel');
const chatProtocolTitle = document.getElementById('chatProtocolTitle');
const chatMeta = document.getElementById('chatMeta');
const chatStatus = document.getElementById('chatStatus');
const chatMessages = document.getElementById('chatMessages');
const chatMessageForm = document.getElementById('chatMessageForm');
const chatMessageInput = document.getElementById('chatMessageInput');

const state = {
  protocol: '',
  email: '',
  pollTimer: null,
  chatVisible: false,
  lastMessageId: ''
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

function statusTone(status) {
  const normalized = String(status || '').toLowerCase();
  if (normalized.includes('resolvido')) return 'success';
  if (normalized.includes('aguardando')) return 'warning';
  if (normalized.includes('atendimento')) return 'warning';
  return 'success';
}

function serviceTone(status) {
  if (status === 'maintenance') return 'warning';
  if (status === 'degraded') return 'danger';
  return 'success';
}

function clearNotice(element) {
  if (!element) return;
  element.className = 'notice hidden';
  element.innerHTML = '';
}

function setNotice(element, html, mode = 'success') {
  if (!element) return;
  element.className = `notice notice-${mode}`;
  element.innerHTML = html;
  element.classList.remove('hidden');
}

function renderServices(services) {
  servicesGrid.innerHTML = services.map((service) => `
    <article class="service-card">
      <div class="service-top">
        <div>
          <h3>${escapeHtml(service.name)}</h3>
          <p>${escapeHtml(service.message)}</p>
        </div>
        <span class="status-pill ${serviceTone(service.status)}">${escapeHtml(service.label)}</span>
      </div>
      <div class="service-meta">Atualizado em ${formatDate(service.updatedAt)}</div>
    </article>
  `).join('');
}

async function loadServices() {
  try {
    const response = await fetch('/api/services');
    const data = await response.json();
    renderServices(data.services || []);
  } catch {
    servicesGrid.innerHTML = `
      <article class="service-card">
        <h3>Não foi possível carregar o status agora.</h3>
        <p>Tente atualizar a página em alguns instantes.</p>
      </article>
    `;
  }
}

function revealChatPanel(shouldScroll = false) {
  chatPanel.classList.remove('hidden');
  if (shouldScroll) {
    chatPanel.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  }
}

function shouldStickToBottom() {
  const threshold = 80;
  return chatMessages.scrollHeight - chatMessages.scrollTop - chatMessages.clientHeight <= threshold;
}

function renderConversation(ticket, options = {}) {
  const { scrollIntoView = false, forceScrollBottom = false } = options;
  const keepAtBottom = forceScrollBottom || !state.chatVisible || shouldStickToBottom();
  const messages = Array.isArray(ticket.messages) ? ticket.messages : [];
  const lastMessage = messages.length ? messages[messages.length - 1].id : '';

  chatProtocolTitle.textContent = ticket.protocol;
  chatMeta.textContent = `${ticket.customer.name} • ${ticket.customer.email} • ${ticket.service || 'Streaming'}`;
  chatStatus.className = `status-pill ${statusTone(ticket.status)}`;
  chatStatus.textContent = ticket.status;

  chatMessages.innerHTML = messages.map((message) => {
    const ownMessage = message.authorType === 'customer';
    const author = ownMessage ? 'Você' : 'Suporte do RDCRIA';
    return `
      <article class="message-bubble ${ownMessage ? 'customer' : 'admin'}">
        <div class="message-meta">
          <strong>${author}</strong>
          <span>${formatDate(message.at)}</span>
        </div>
        <p>${escapeHtml(message.text)}</p>
      </article>
    `;
  }).join('') || `
    <article class="message-bubble admin">
      <div class="message-meta">
        <strong>Suporte do RDCRIA</strong>
      </div>
      <p>Sua conversa foi aberta.</p>
    </article>
  `;

  revealChatPanel(scrollIntoView);

  if (keepAtBottom || lastMessage !== state.lastMessageId) {
    chatMessages.scrollTop = chatMessages.scrollHeight;
  }

  state.chatVisible = true;
  state.lastMessageId = lastMessage;
}

async function loadConversation(options = {}) {
  if (!state.protocol || !state.email) return;

  const response = await fetch(`/api/tickets/lookup?protocol=${encodeURIComponent(state.protocol)}&email=${encodeURIComponent(state.email)}`);
  const data = await response.json();

  if (!response.ok) {
    throw new Error(data.error || 'Não foi possível abrir a conversa.');
  }

  renderConversation(data.ticket, options);
}

function setConversation(protocol, email) {
  state.protocol = protocol.trim().toUpperCase();
  state.email = email.trim().toLowerCase();

  if (state.pollTimer) {
    clearInterval(state.pollTimer);
  }

  state.pollTimer = setInterval(async () => {
    try {
      await loadConversation();
    } catch {}
  }, 5000);
}

startForm?.addEventListener('submit', async (event) => {
  event.preventDefault();
  const button = startForm.querySelector('button[type="submit"]');
  const payload = Object.fromEntries(new FormData(startForm).entries());

  button.disabled = true;
  button.textContent = 'Abrindo atendimento...';
  clearNotice(startFeedback);
  clearNotice(resumeFeedback);

  try {
    const response = await fetch('/api/tickets', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
    const data = await response.json();

    if (!response.ok) {
      throw new Error(data.error || 'Não foi possível abrir o atendimento.');
    }

    setNotice(
      startFeedback,
      `<strong>Atendimento iniciado.</strong><br>Seu protocolo é <strong>${escapeHtml(data.protocol)}</strong>. Guarde este código para continuar a conversa.`,
      'success'
    );

    if (resumeForm?.protocol) resumeForm.protocol.value = data.protocol;
    if (resumeForm?.email) resumeForm.email.value = payload.email;
    startForm.reset();

    setConversation(data.protocol, payload.email);
    await loadConversation({ scrollIntoView: true, forceScrollBottom: true });
    chatMessageInput?.focus();
  } catch (error) {
    setNotice(startFeedback, escapeHtml(error.message), 'error');
  } finally {
    button.disabled = false;
    button.textContent = 'Abrir atendimento';
  }
});

resumeForm?.addEventListener('submit', async (event) => {
  event.preventDefault();
  const button = resumeForm.querySelector('button[type="submit"]');
  const protocol = resumeForm.protocol.value.trim();
  const email = resumeForm.email.value.trim();

  button.disabled = true;
  button.textContent = 'Abrindo conversa...';
  clearNotice(resumeFeedback);

  try {
    setConversation(protocol, email);
    await loadConversation({ scrollIntoView: true, forceScrollBottom: true });
    setNotice(resumeFeedback, 'Conversa aberta com sucesso.', 'success');
    chatMessageInput?.focus();
  } catch (error) {
    setNotice(resumeFeedback, escapeHtml(error.message), 'error');
  } finally {
    button.disabled = false;
    button.textContent = 'Abrir conversa';
  }
});

chatMessageForm?.addEventListener('submit', async (event) => {
  event.preventDefault();
  if (!state.protocol || !state.email) return;

  const button = chatMessageForm.querySelector('button[type="submit"]');
  const message = chatMessageInput.value.trim();

  if (!message) return;

  button.disabled = true;
  button.textContent = 'Enviando...';

  try {
    const response = await fetch('/api/tickets/message', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        protocol: state.protocol,
        email: state.email,
        message
      })
    });

    const data = await response.json();

    if (!response.ok) {
      throw new Error(data.error || 'Não foi possível enviar a mensagem.');
    }

    chatMessageInput.value = '';
    renderConversation(data.ticket, { forceScrollBottom: true });
    chatMessageInput.focus();
  } catch (error) {
    alert(error.message);
  } finally {
    button.disabled = false;
    button.textContent = 'Enviar mensagem';
  }
});

loadServices();
