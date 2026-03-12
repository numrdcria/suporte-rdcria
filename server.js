const http = require('http');
const fs = require('fs');
const fsp = require('fs/promises');
const path = require('path');
const crypto = require('crypto');
const { URL } = require('url');

const PORT = Number(process.env.PORT || 3000);
const HOST = process.env.HOST || '0.0.0.0';

const SITE_NAME = process.env.SITE_NAME || 'Suporte do RDCRIA';
const ADMIN_USER = process.env.ADMIN_USER || 'Num';
const ADMIN_PASS = process.env.ADMIN_PASS || 'rdcria2026';

const ROOT_DIR = __dirname;
const PUBLIC_DIR = path.join(ROOT_DIR, 'public');
const DATA_DIR = path.join(ROOT_DIR, 'data');

const FILES = {
  tickets: path.join(DATA_DIR, 'tickets.json'),
  services: path.join(DATA_DIR, 'services.json'),
  meta: path.join(DATA_DIR, 'meta.json'),
  timeclock: path.join(DATA_DIR, 'timeclock.json')
};

const sessions = new Map();

const MIME_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.ico': 'image/x-icon',
  '.webp': 'image/webp'
};

const DEFAULT_SERVICES = [
  {
    id: 'login',
    name: 'Login e acesso',
    status: 'operational',
    label: 'Estável',
    message: 'Acesso funcionando normalmente.',
    updatedAt: new Date().toISOString()
  },
  {
    id: 'live',
    name: 'Canais ao vivo',
    status: 'operational',
    label: 'Estável',
    message: 'Transmissões sem incidentes ativos.',
    updatedAt: new Date().toISOString()
  },
  {
    id: 'vod',
    name: 'Filmes e séries',
    status: 'operational',
    label: 'Estável',
    message: 'Catálogo disponível normalmente.',
    updatedAt: new Date().toISOString()
  }
];

const DEFAULT_TIMECLOCK = {
  employees: [],
  shifts: []
};

async function ensureStorage() {
  await fsp.mkdir(DATA_DIR, { recursive: true });
  if (!(await exists(FILES.tickets))) {
    await writeJson(FILES.tickets, []);
  }
  if (!(await exists(FILES.services))) {
    await writeJson(FILES.services, DEFAULT_SERVICES);
  }
  if (!(await exists(FILES.meta))) {
    await writeJson(FILES.meta, { ticketSequence: 0 });
  }
  if (!(await exists(FILES.timeclock))) {
    await writeJson(FILES.timeclock, DEFAULT_TIMECLOCK);
  }
}

async function exists(filePath) {
  try {
    await fsp.access(filePath);
    return true;
  } catch {
    return false;
  }
}

async function readJson(filePath, fallback) {
  try {
    const content = await fsp.readFile(filePath, 'utf8');
    return JSON.parse(content);
  } catch {
    return fallback;
  }
}

async function writeJson(filePath, data) {
  const tempPath = `${filePath}.tmp`;
  await fsp.writeFile(tempPath, JSON.stringify(data, null, 2), 'utf8');
  await fsp.rename(tempPath, filePath);
}

function createId(bytes = 12) {
  return crypto.randomBytes(bytes).toString('hex');
}

function localDateKey(value = new Date()) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  const year = String(date.getFullYear());
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function isSameLocalDay(a, b = new Date()) {
  return localDateKey(a) === localDateKey(b);
}

function minutesBetween(startAt, endAt = new Date().toISOString()) {
  const start = new Date(startAt).getTime();
  const end = new Date(endAt).getTime();
  if (!Number.isFinite(start) || !Number.isFinite(end)) return 0;
  return Math.max(0, Math.round((end - start) / 60000));
}

function hydrateTimeclock(data) {
  const normalized = data && typeof data === 'object' ? data : {};
  return {
    employees: Array.isArray(normalized.employees) ? normalized.employees : [],
    shifts: Array.isArray(normalized.shifts) ? normalized.shifts : []
  };
}

function findEmployeeByName(timeclock, name) {
  const normalized = sanitizeString(name, 80).toLowerCase();
  if (!normalized) return null;
  return timeclock.employees.find((item) => sanitizeString(item.name, 80).toLowerCase() === normalized) || null;
}

function upsertEmployee(timeclock, name) {
  const cleanName = sanitizeString(name, 80);
  if (!cleanName) {
    throw new Error('Informe o nome do funcionario.');
  }

  let employee = findEmployeeByName(timeclock, cleanName);
  if (employee) {
    return { employee, created: false };
  }

  employee = {
    id: createId(8),
    name: cleanName,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString()
  };

  timeclock.employees.unshift(employee);
  return { employee, created: true };
}

function buildTimeclockView(data) {
  const timeclock = hydrateTimeclock(data);
  const shifts = [...timeclock.shifts]
    .map((item) => ({
      ...item,
      workedMinutes: item.clockOutAt
        ? Number(item.workedMinutes || minutesBetween(item.clockInAt, item.clockOutAt))
        : minutesBetween(item.clockInAt)
    }))
    .sort((a, b) => {
      const left = new Date(b.clockOutAt || b.clockInAt).getTime();
      const right = new Date(a.clockOutAt || a.clockInAt).getTime();
      return left - right;
    });

  const employees = [...timeclock.employees]
    .sort((a, b) => String(a.name || '').localeCompare(String(b.name || ''), 'pt-BR'))
    .map((employee) => {
      const employeeShifts = shifts
        .filter((item) => item.employeeId === employee.id)
        .sort((a, b) => new Date(b.clockInAt).getTime() - new Date(a.clockInAt).getTime());
      const openShift = employeeShifts.find((item) => !item.clockOutAt) || null;
      const lastShift = employeeShifts[0] || null;
      const workedTodayMinutes = employeeShifts
        .filter((item) => isSameLocalDay(item.clockInAt))
        .reduce((sum, item) => sum + (item.clockOutAt ? Number(item.workedMinutes || 0) : minutesBetween(item.clockInAt)), 0);

      return {
        id: employee.id,
        name: employee.name,
        createdAt: employee.createdAt,
        updatedAt: employee.updatedAt,
        status: openShift ? 'working' : 'off',
        workedTodayMinutes,
        activeShift: openShift
          ? {
              id: openShift.id,
              clockInAt: openShift.clockInAt,
              workedMinutes: minutesBetween(openShift.clockInAt)
            }
          : null,
        lastShift: lastShift
          ? {
              id: lastShift.id,
              clockInAt: lastShift.clockInAt,
              clockOutAt: lastShift.clockOutAt || null,
              workedMinutes: lastShift.clockOutAt ? Number(lastShift.workedMinutes || 0) : minutesBetween(lastShift.clockInAt)
            }
          : null
      };
    });

  const summary = {
    totalEmployees: employees.length,
    workingNow: employees.filter((item) => item.status === 'working').length,
    closedToday: shifts.filter((item) => item.clockOutAt && isSameLocalDay(item.clockOutAt)).length,
    totalWorkedTodayMinutes: employees.reduce((sum, item) => sum + item.workedTodayMinutes, 0)
  };

  const recentShifts = shifts.slice(0, 40).map((item) => ({
    id: item.id,
    employeeId: item.employeeId,
    employeeName: item.employeeName,
    clockInAt: item.clockInAt,
    clockOutAt: item.clockOutAt || null,
    workedMinutes: item.clockOutAt ? Number(item.workedMinutes || 0) : minutesBetween(item.clockInAt),
    status: item.clockOutAt ? 'closed' : 'open'
  }));

  return {
    summary,
    employees,
    recentShifts,
    serverNow: new Date().toISOString()
  };
}

function sendJson(res, statusCode, payload, extraHeaders = {}) {
  res.writeHead(statusCode, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
    ...extraHeaders
  });
  res.end(JSON.stringify(payload));
}

function sendText(res, statusCode, text, contentType = 'text/plain; charset=utf-8') {
  res.writeHead(statusCode, { 'Content-Type': contentType });
  res.end(text);
}

async function sendFile(res, filePath) {
  try {
    const stat = await fsp.stat(filePath);
    const ext = path.extname(filePath).toLowerCase();
    const mimeType = MIME_TYPES[ext] || 'application/octet-stream';

    res.writeHead(200, {
      'Content-Type': mimeType,
      'Content-Length': stat.size
    });

    fs.createReadStream(filePath).pipe(res);
  } catch {
    sendText(res, 404, 'Arquivo nao encontrado.');
  }
}

function parseCookies(req) {
  const raw = req.headers.cookie || '';
  return raw.split(';').reduce((acc, part) => {
    const [key, ...rest] = part.trim().split('=');
    if (!key) return acc;
    acc[key] = decodeURIComponent(rest.join('=') || '');
    return acc;
  }, {});
}

function createSession(username) {
  const token = crypto.randomBytes(24).toString('hex');
  sessions.set(token, { username, createdAt: new Date().toISOString() });
  return token;
}

function getSession(req) {
  const cookies = parseCookies(req);
  const token = cookies.rdc_session;
  if (!token) return null;
  return sessions.get(token) || null;
}

function destroySession(req) {
  const cookies = parseCookies(req);
  const token = cookies.rdc_session;
  if (token) sessions.delete(token);
}

function requireAdmin(req, res) {
  const session = getSession(req);
  if (!session) {
    sendJson(res, 401, { error: 'Nao autenticado.' });
    return null;
  }
  return session;
}

async function parseBody(req) {
  const MAX_SIZE = 1024 * 1024;
  let size = 0;
  const chunks = [];
  return new Promise((resolve, reject) => {
    req.on('data', (chunk) => {
      size += chunk.length;
      if (size > MAX_SIZE) {
        reject(new Error('Payload muito grande.'));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => {
      try {
        const raw = Buffer.concat(chunks).toString('utf8');
        if (!raw) return resolve({});
        resolve(JSON.parse(raw));
      } catch {
        reject(new Error('JSON invalido.'));
      }
    });
    req.on('error', reject);
  });
}

function sanitizeString(value, maxLength = 500) {
  return String(value || '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, maxLength);
}

function sanitizeText(value, maxLength = 4000) {
  return String(value || '')
    .replace(/\r/g, '')
    .trim()
    .slice(0, maxLength);
}

function formatProtocol(sequence) {
  const now = new Date();
  const y = String(now.getFullYear());
  const m = String(now.getMonth() + 1).padStart(2, '0');
  const d = String(now.getDate()).padStart(2, '0');
  const serial = String(sequence).padStart(4, '0');
  return `RDC-${y}${m}${d}-${serial}`;
}

function makeMessage(authorType, text, options = {}) {
  const isPublic = options.public !== false;
  const authorName = options.authorName || (authorType === 'admin' ? SITE_NAME : 'Cliente');
  return {
    id: crypto.randomBytes(12).toString('hex'),
    at: new Date().toISOString(),
    authorType,
    authorName: sanitizeString(authorName, 80),
    text: sanitizeText(text, 3000),
    public: isPublic
  };
}

function publicTicketView(ticket) {
  return {
    protocol: ticket.protocol,
    createdAt: ticket.createdAt,
    updatedAt: ticket.updatedAt,
    status: ticket.status,
    service: ticket.service,
    device: ticket.device,
    customer: {
      name: ticket.customer.name,
      email: ticket.customer.email
    },
    messages: (ticket.messages || []).filter((item) => item.public).map((item) => ({
      id: item.id,
      at: item.at,
      authorType: item.authorType,
      authorName: item.authorType === 'admin' ? SITE_NAME : ticket.customer.name,
      text: item.text
    }))
  };
}

function adminTicketView(ticket) {
  return {
    ...ticket,
    messages: ticket.messages || []
  };
}

async function createTicket(payload) {
  const name = sanitizeString(payload.name, 100);
  const email = sanitizeString(payload.email, 140).toLowerCase();
  const service = sanitizeString(payload.service, 80) || 'Streaming';
  const device = sanitizeString(payload.device, 80);
  const message = sanitizeText(payload.message, 3000);

  if (!name || !email || !message) {
    throw new Error('Preencha nome, email e mensagem.');
  }
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    throw new Error('Informe um email valido.');
  }

  const meta = await readJson(FILES.meta, { ticketSequence: 0 });
  const nextSequence = Number(meta.ticketSequence || 0) + 1;
  meta.ticketSequence = nextSequence;
  await writeJson(FILES.meta, meta);

  const protocol = formatProtocol(nextSequence);
  const now = new Date().toISOString();

  const ticket = {
    id: protocol,
    protocol,
    createdAt: now,
    updatedAt: now,
    status: 'Aberto',
    service,
    device,
    assignedTo: '',
    adminNotes: '',
    customer: { name, email },
    messages: [makeMessage('customer', message, { authorName: name, public: true })]
  };

  const tickets = await readJson(FILES.tickets, []);
  tickets.unshift(ticket);
  await writeJson(FILES.tickets, tickets);

  return ticket;
}

function getDashboardStats(tickets) {
  return {
    total: tickets.length,
    open: tickets.filter((item) => item.status === 'Aberto').length,
    inProgress: tickets.filter((item) => item.status === 'Em atendimento').length,
    waiting: tickets.filter((item) => item.status === 'Aguardando cliente').length,
    resolved: tickets.filter((item) => item.status === 'Resolvido').length
  };
}

async function updateTicket(protocol, updater) {
  const tickets = await readJson(FILES.tickets, []);
  const index = tickets.findIndex((item) => item.protocol === protocol);
  if (index === -1) {
    return null;
  }
  const ticket = tickets[index];
  await updater(ticket, tickets, index);
  ticket.updatedAt = new Date().toISOString();
  tickets[index] = ticket;
  await writeJson(FILES.tickets, tickets);
  return ticket;
}

function notFound(res) {
  return sendJson(res, 404, { error: 'Rota nao encontrada.' });
}

async function handleApi(req, res, parsedUrl) {
  if (req.method === 'GET' && parsedUrl.pathname === '/api/services') {
    const services = await readJson(FILES.services, DEFAULT_SERVICES);
    return sendJson(res, 200, { siteName: SITE_NAME, services });
  }

  if (req.method === 'POST' && parsedUrl.pathname === '/api/tickets') {
    try {
      const body = await parseBody(req);
      const ticket = await createTicket(body);
      return sendJson(res, 201, {
        ok: true,
        protocol: ticket.protocol,
        ticket: publicTicketView(ticket)
      });
    } catch (error) {
      return sendJson(res, 400, { error: error.message || 'Nao foi possivel iniciar o atendimento.' });
    }
  }

  if (req.method === 'GET' && parsedUrl.pathname === '/api/tickets/lookup') {
    const protocol = sanitizeString(parsedUrl.searchParams.get('protocol'), 40).toUpperCase();
    const email = sanitizeString(parsedUrl.searchParams.get('email'), 140).toLowerCase();

    if (!protocol || !email) {
      return sendJson(res, 400, { error: 'Informe codigo e email.' });
    }

    const tickets = await readJson(FILES.tickets, []);
    const ticket = tickets.find((item) => item.protocol === protocol && item.customer.email === email);

    if (!ticket) {
      return sendJson(res, 404, { error: 'Atendimento nao encontrado para os dados informados.' });
    }

    return sendJson(res, 200, { ticket: publicTicketView(ticket) });
  }

  if (req.method === 'POST' && parsedUrl.pathname === '/api/tickets/message') {
    try {
      const body = await parseBody(req);
      const protocol = sanitizeString(body.protocol, 40).toUpperCase();
      const email = sanitizeString(body.email, 140).toLowerCase();
      const message = sanitizeText(body.message, 3000);

      if (!protocol || !email || !message) {
        return sendJson(res, 400, { error: 'Informe codigo, email e mensagem.' });
      }

      const ticket = await updateTicket(protocol, async (item) => {
        if (item.customer.email !== email) {
          throw new Error('Atendimento nao encontrado para os dados informados.');
        }
        item.messages = item.messages || [];
        item.messages.push(makeMessage('customer', message, {
          authorName: item.customer.name,
          public: true
        }));
        if (item.status === 'Aguardando cliente' || item.status === 'Resolvido') {
          item.status = 'Aberto';
        }
      });

      if (!ticket) {
        return sendJson(res, 404, { error: 'Atendimento nao encontrado.' });
      }

      return sendJson(res, 200, { ok: true, ticket: publicTicketView(ticket) });
    } catch (error) {
      return sendJson(res, 400, { error: error.message || 'Nao foi possivel enviar a mensagem.' });
    }
  }

  if (req.method === 'POST' && parsedUrl.pathname === '/api/admin/login') {
    try {
      const body = await parseBody(req);
      const username = sanitizeString(body.username, 60);
      const password = sanitizeString(body.password, 120);

      if (username !== ADMIN_USER || password !== ADMIN_PASS) {
        return sendJson(res, 401, { error: 'Acesso negado.' });
      }

      const token = createSession(username);
      return sendJson(
        res,
        200,
        { ok: true, username, siteName: SITE_NAME },
        {
          'Set-Cookie': `rdc_session=${encodeURIComponent(token)}; HttpOnly; Path=/; SameSite=Lax; Max-Age=28800`
        }
      );
    } catch (error) {
      return sendJson(res, 400, { error: error.message || 'Nao foi possivel entrar.' });
    }
  }

  if (req.method === 'POST' && parsedUrl.pathname === '/api/admin/logout') {
    destroySession(req);
    return sendJson(
      res,
      200,
      { ok: true },
      { 'Set-Cookie': 'rdc_session=; HttpOnly; Path=/; SameSite=Lax; Max-Age=0' }
    );
  }

  if (req.method === 'GET' && parsedUrl.pathname === '/api/admin/me') {
    const session = getSession(req);
    if (!session) {
      return sendJson(res, 401, { error: 'Nao autenticado.' });
    }
    return sendJson(res, 200, { username: session.username, siteName: SITE_NAME });
  }

  if (req.method === 'GET' && parsedUrl.pathname === '/api/admin/dashboard') {
    if (!requireAdmin(req, res)) return;
    const tickets = await readJson(FILES.tickets, []);
    const services = await readJson(FILES.services, DEFAULT_SERVICES);
    return sendJson(res, 200, {
      stats: getDashboardStats(tickets),
      recentTickets: tickets.slice(0, 50).map(adminTicketView),
      services
    });
  }

  if (req.method === 'GET' && parsedUrl.pathname === '/api/admin/tickets') {
    if (!requireAdmin(req, res)) return;
    const status = sanitizeString(parsedUrl.searchParams.get('status'), 40);
    const search = sanitizeString(parsedUrl.searchParams.get('search'), 160).toLowerCase();
    const tickets = await readJson(FILES.tickets, []);

    let filtered = tickets;
    if (status && status !== 'Todos') {
      filtered = filtered.filter((item) => item.status === status);
    }
    if (search) {
      filtered = filtered.filter((item) => {
        const haystack = [
          item.protocol,
          item.customer.name,
          item.customer.email,
          item.service,
          item.device
        ].join(' ').toLowerCase();
        return haystack.includes(search);
      });
    }

    return sendJson(res, 200, { tickets: filtered.map(adminTicketView) });
  }

  if (req.method === 'GET' && /^\/api\/admin\/tickets\/[^/]+$/.test(parsedUrl.pathname)) {
    if (!requireAdmin(req, res)) return;
    const protocol = decodeURIComponent(parsedUrl.pathname.split('/').pop() || '');
    const tickets = await readJson(FILES.tickets, []);
    const ticket = tickets.find((item) => item.protocol === protocol);
    if (!ticket) {
      return sendJson(res, 404, { error: 'Atendimento nao encontrado.' });
    }
    return sendJson(res, 200, { ticket: adminTicketView(ticket) });
  }

  if (req.method === 'PATCH' && /^\/api\/admin\/tickets\/[^/]+$/.test(parsedUrl.pathname)) {
    const session = requireAdmin(req, res);
    if (!session) return;
    try {
      const protocol = decodeURIComponent(parsedUrl.pathname.split('/').pop() || '');
      const body = await parseBody(req);

      const ticket = await updateTicket(protocol, async (item) => {
        if (Object.prototype.hasOwnProperty.call(body, 'status')) {
          const nextStatus = sanitizeString(body.status, 40);
          if (nextStatus) item.status = nextStatus;
        }
        if (Object.prototype.hasOwnProperty.call(body, 'assignedTo')) {
          item.assignedTo = sanitizeString(body.assignedTo, 80);
        }
        if (Object.prototype.hasOwnProperty.call(body, 'adminNotes')) {
          item.adminNotes = sanitizeText(body.adminNotes, 4000);
        }
      });

      if (!ticket) {
        return sendJson(res, 404, { error: 'Atendimento nao encontrado.' });
      }

      return sendJson(res, 200, { ok: true, ticket: adminTicketView(ticket), updatedBy: session.username });
    } catch (error) {
      return sendJson(res, 400, { error: error.message || 'Nao foi possivel salvar.' });
    }
  }

  if (req.method === 'POST' && /^\/api\/admin\/tickets\/[^/]+\/message$/.test(parsedUrl.pathname)) {
    const session = requireAdmin(req, res);
    if (!session) return;
    try {
      const parts = parsedUrl.pathname.split('/');
      const protocol = decodeURIComponent(parts[parts.length - 2] || '');
      const body = await parseBody(req);
      const message = sanitizeText(body.message, 3000);
      const isPublic = body.public !== false;
      const nextStatus = sanitizeString(body.status, 40);

      if (!message) {
        return sendJson(res, 400, { error: 'Digite uma mensagem.' });
      }

      const ticket = await updateTicket(protocol, async (item) => {
        item.messages = item.messages || [];
        item.messages.push(makeMessage('admin', message, {
          public: isPublic,
          authorName: isPublic ? SITE_NAME : session.username
        }));
        if (nextStatus) {
          item.status = nextStatus;
        } else if (isPublic && item.status === 'Aberto') {
          item.status = 'Em atendimento';
        }
      });

      if (!ticket) {
        return sendJson(res, 404, { error: 'Atendimento nao encontrado.' });
      }

      return sendJson(res, 200, { ok: true, ticket: adminTicketView(ticket) });
    } catch (error) {
      return sendJson(res, 400, { error: error.message || 'Nao foi possivel enviar a mensagem.' });
    }
  }


  if (req.method === 'GET' && parsedUrl.pathname === '/api/admin/timeclock') {
    if (!requireAdmin(req, res)) return;
    const timeclock = hydrateTimeclock(await readJson(FILES.timeclock, DEFAULT_TIMECLOCK));
    return sendJson(res, 200, buildTimeclockView(timeclock));
  }

  if (req.method === 'POST' && parsedUrl.pathname === '/api/admin/timeclock/employees') {
    if (!requireAdmin(req, res)) return;
    try {
      const body = await parseBody(req);
      const timeclock = hydrateTimeclock(await readJson(FILES.timeclock, DEFAULT_TIMECLOCK));
      const result = upsertEmployee(timeclock, body.name);
      result.employee.updatedAt = new Date().toISOString();
      await writeJson(FILES.timeclock, timeclock);
      return sendJson(res, 200, {
        ok: true,
        created: result.created,
        employee: result.employee,
        ...buildTimeclockView(timeclock)
      });
    } catch (error) {
      return sendJson(res, 400, { error: error.message || 'Nao foi possivel cadastrar o funcionario.' });
    }
  }

  if (req.method === 'POST' && parsedUrl.pathname === '/api/admin/timeclock/punch') {
    if (!requireAdmin(req, res)) return;
    try {
      const body = await parseBody(req);
      const action = sanitizeString(body.action, 10).toLowerCase();

      if (!['in', 'out'].includes(action)) {
        return sendJson(res, 400, { error: 'Acao de ponto invalida.' });
      }

      const timeclock = hydrateTimeclock(await readJson(FILES.timeclock, DEFAULT_TIMECLOCK));
      let employee = sanitizeString(body.employeeId, 40)
        ? timeclock.employees.find((item) => item.id === sanitizeString(body.employeeId, 40))
        : null;

      if (!employee && body.name) {
        employee = upsertEmployee(timeclock, body.name).employee;
      }

      if (!employee) {
        return sendJson(res, 404, { error: 'Funcionario nao encontrado.' });
      }

      const now = new Date().toISOString();
      const employeeShifts = timeclock.shifts
        .filter((item) => item.employeeId === employee.id)
        .sort((a, b) => new Date(b.clockInAt).getTime() - new Date(a.clockInAt).getTime());
      const openShift = employeeShifts.find((item) => !item.clockOutAt) || null;

      if (action === 'in') {
        if (openShift) {
          return sendJson(res, 400, { error: 'Ja existe uma entrada aberta para este funcionario.' });
        }

        const shift = {
          id: createId(10),
          employeeId: employee.id,
          employeeName: employee.name,
          clockInAt: now,
          clockOutAt: null,
          workedMinutes: 0,
          status: 'open'
        };

        employee.updatedAt = now;
        timeclock.shifts.unshift(shift);
        await writeJson(FILES.timeclock, timeclock);
        return sendJson(res, 200, { ok: true, shift, ...buildTimeclockView(timeclock) });
      }

      if (!openShift) {
        return sendJson(res, 400, { error: 'Nao existe entrada em aberto para este funcionario.' });
      }

      openShift.clockOutAt = now;
      openShift.workedMinutes = minutesBetween(openShift.clockInAt, now);
      openShift.status = 'closed';
      employee.updatedAt = now;

      await writeJson(FILES.timeclock, timeclock);
      return sendJson(res, 200, { ok: true, shift: openShift, ...buildTimeclockView(timeclock) });
    } catch (error) {
      return sendJson(res, 400, { error: error.message || 'Nao foi possivel registrar o ponto.' });
    }
  }

  if (req.method === 'GET' && parsedUrl.pathname === '/api/admin/services') {
    if (!requireAdmin(req, res)) return;
    const services = await readJson(FILES.services, DEFAULT_SERVICES);
    return sendJson(res, 200, { services });
  }

  if (req.method === 'PATCH' && parsedUrl.pathname === '/api/admin/services') {
    if (!requireAdmin(req, res)) return;
    try {
      const body = await parseBody(req);
      if (!Array.isArray(body.services)) {
        return sendJson(res, 400, { error: 'Formato invalido.' });
      }

      const services = body.services.map((item) => ({
        id: sanitizeString(item.id, 60),
        name: sanitizeString(item.name, 80),
        status: sanitizeString(item.status, 40) || 'operational',
        label: sanitizeString(item.label, 40) || 'Estável',
        message: sanitizeText(item.message, 200),
        updatedAt: new Date().toISOString()
      }));

      await writeJson(FILES.services, services);
      return sendJson(res, 200, { ok: true, services });
    } catch (error) {
      return sendJson(res, 400, { error: error.message || 'Nao foi possivel salvar os servicos.' });
    }
  }

  return notFound(res);
}

async function handleStatic(req, res, parsedUrl) {
  if (parsedUrl.pathname === '/') {
    return sendFile(res, path.join(PUBLIC_DIR, 'index.html'));
  }
  if (parsedUrl.pathname === '/admin') {
    return sendFile(res, path.join(PUBLIC_DIR, 'admin.html'));
  }

  const safePath = path.normalize(parsedUrl.pathname).replace(/^(\.\.[/\\])+/, '');
  const filePath = path.join(PUBLIC_DIR, safePath);

  if (!filePath.startsWith(PUBLIC_DIR)) {
    return sendText(res, 403, 'Acesso negado.');
  }

  if (await exists(filePath)) {
    return sendFile(res, filePath);
  }

  return sendText(res, 404, 'Pagina nao encontrada.');
}

async function requestHandler(req, res) {
  try {
    const parsedUrl = new URL(req.url, `http://${req.headers.host || 'localhost'}`);

    if (req.method === 'OPTIONS') {
      res.writeHead(204);
      return res.end();
    }

    if (parsedUrl.pathname.startsWith('/api/')) {
      return await handleApi(req, res, parsedUrl);
    }

    return await handleStatic(req, res, parsedUrl);
  } catch (error) {
    console.error('Erro interno:', error);
    return sendJson(res, 500, { error: 'Erro interno do servidor.' });
  }
}

async function start() {
  await ensureStorage();
  const server = http.createServer(requestHandler);
  server.listen(PORT, HOST, () => {
    console.log(`${SITE_NAME} ativo em http://localhost:${PORT}`);
    console.log(`Painel administrativo em http://localhost:${PORT}/admin`);
  });
}

start().catch((error) => {
  console.error('Falha ao iniciar o servidor:', error);
  process.exit(1);
});
