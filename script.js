const state = {
  draftItems: []
};

const warehouseTable = document.getElementById('warehouseTable');
const ordersTable = document.getElementById('ordersTable');
const historyViewer = document.getElementById('historyViewer');
const orderItemsDraft = document.getElementById('orderItemsDraft');

async function request(url, options = {}) {
  const response = await fetch(url, {
    headers: { 'Content-Type': 'application/json' },
    ...options
  });

  const isJson = response.headers.get('content-type')?.includes('application/json');
  const payload = isJson ? await response.json() : null;

  if (!response.ok) {
    const message = payload?.error || `Request failed with status ${response.status}`;
    throw new Error(message);
  }

  return payload;
}

function renderDraftItems() {
  orderItemsDraft.innerHTML = '';

  state.draftItems.forEach((item, index) => {
    const li = document.createElement('li');
    li.className = 'flex items-center gap-2';
    li.innerHTML = `${item.itemId} | required: ${item.requiredQuantity} | picked: ${item.pickedQuantity}`;

    const btn = document.createElement('button');
    btn.textContent = 'Удалить';
    btn.className = 'bg-red-600 text-white rounded px-2 py-1 text-xs';
    btn.addEventListener('click', () => {
      state.draftItems.splice(index, 1);
      renderDraftItems();
    });

    li.appendChild(btn);
    orderItemsDraft.appendChild(li);
  });
}

async function loadWarehouse(search = '') {
  const query = search ? `?search=${encodeURIComponent(search)}` : '';
  const items = await request(`/api/warehouse${query}`);

  warehouseTable.innerHTML = '';

  for (const item of items) {
    const tr = document.createElement('tr');
    tr.className = 'border-b';

    tr.innerHTML = `
      <td class="py-2">${item.id}</td>
      <td class="py-2">${item.name}</td>
      <td class="py-2">${item.quantity}</td>
      <td class="py-2">${item.category || ''}</td>
      <td class="py-2 space-x-2">
        <button data-action="restock" data-id="${item.id}" class="bg-amber-500 text-white rounded px-2 py-1">Пополнить +1</button>
        <button data-action="delete" data-id="${item.id}" class="bg-red-600 text-white rounded px-2 py-1">Удалить</button>
      </td>
    `;

    warehouseTable.appendChild(tr);
  }
}

async function loadOrders() {
  const orders = await request('/api/orders');
  ordersTable.innerHTML = '';

  for (const order of orders) {
    const tr = document.createElement('tr');
    tr.className = 'border-b align-top';
    const itemsText = order.items
      .map((it) => `${it.itemId} (${it.pickedQuantity}/${it.requiredQuantity})`)
      .join(', ');

    tr.innerHTML = `
      <td class="py-2">${order.id}</td>
      <td class="py-2">${order.customer}</td>
      <td class="py-2">${order.date}</td>
      <td class="py-2">${order.status}</td>
      <td class="py-2">${itemsText || '-'}</td>
      <td class="py-2 space-x-2">
        <button data-action="history" data-id="${order.id}" class="bg-slate-700 text-white rounded px-2 py-1">История</button>
        <button data-action="edit" data-id="${order.id}" class="bg-blue-600 text-white rounded px-2 py-1">Редактировать</button>
        <button data-action="delete" data-id="${order.id}" class="bg-red-600 text-white rounded px-2 py-1">Удалить</button>
      </td>
    `;

    ordersTable.appendChild(tr);
  }
}

async function showHistory(orderId) {
  const history = await request(`/api/orders/${orderId}/history`);
  historyViewer.textContent = JSON.stringify(history, null, 2);
}

function fillOrderForm(order) {
  document.getElementById('orderId').value = order.id;
  document.getElementById('orderId').setAttribute('readonly', 'readonly');
  document.getElementById('orderCustomer').value = order.customer;
  document.getElementById('orderDate').value = order.date;
  document.getElementById('orderAssemblyLocation').value = order.assemblyLocation || '';
  document.getElementById('orderStatus').value = order.status;
  document.getElementById('orderNote').value = order.note || '';
  document.getElementById('orderT34Passport').checked = Boolean(order.t34Passport);

  state.draftItems = order.items.map((it) => ({
    itemId: it.itemId,
    requiredQuantity: it.requiredQuantity,
    pickedQuantity: it.pickedQuantity
  }));
  renderDraftItems();
}

async function init() {
  document.getElementById('searchWarehouseBtn').addEventListener('click', async () => {
    try {
      const search = document.getElementById('warehouseSearch').value.trim();
      await loadWarehouse(search);
    } catch (error) {
      alert(error.message);
    }
  });

  document.getElementById('refreshWarehouseBtn').addEventListener('click', async () => {
    try {
      await loadWarehouse();
    } catch (error) {
      alert(error.message);
    }
  });

  document.getElementById('warehouseForm').addEventListener('submit', async (event) => {
    event.preventDefault();

    try {
      await request('/api/warehouse', {
        method: 'POST',
        body: JSON.stringify({
          id: document.getElementById('warehouseId').value.trim(),
          name: document.getElementById('warehouseName').value.trim(),
          quantity: Number(document.getElementById('warehouseQuantity').value),
          category: document.getElementById('warehouseCategory').value.trim() || null
        })
      });

      event.target.reset();
      await loadWarehouse();
    } catch (error) {
      alert(error.message);
    }
  });

  warehouseTable.addEventListener('click', async (event) => {
    const btn = event.target.closest('button');
    if (!btn) {
      return;
    }

    const { action, id } = btn.dataset;

    try {
      if (action === 'delete') {
        await request(`/api/warehouse/${id}`, { method: 'DELETE' });
      }

      if (action === 'restock') {
        const row = btn.closest('tr');
        const currentQuantity = Number(row.children[2].textContent);
        await request(`/api/warehouse/${id}`, {
          method: 'PUT',
          body: JSON.stringify({ quantity: currentQuantity + 1 })
        });
      }

      await loadWarehouse(document.getElementById('warehouseSearch').value.trim());
    } catch (error) {
      alert(error.message);
    }
  });

  document.getElementById('addOrderItemBtn').addEventListener('click', () => {
    const itemId = document.getElementById('orderItemId').value.trim();
    const requiredQuantity = Number(document.getElementById('orderRequiredQuantity').value);
    const pickedQuantity = Number(document.getElementById('orderPickedQuantity').value || 0);

    if (!itemId || Number.isNaN(requiredQuantity) || Number.isNaN(pickedQuantity)) {
      alert('Заполните itemId, requiredQuantity и pickedQuantity');
      return;
    }

    state.draftItems.push({ itemId, requiredQuantity, pickedQuantity });
    renderDraftItems();

    document.getElementById('orderItemId').value = '';
    document.getElementById('orderRequiredQuantity').value = '';
    document.getElementById('orderPickedQuantity').value = '0';
  });

  document.getElementById('orderForm').addEventListener('submit', async (event) => {
    event.preventDefault();

    const payload = {
      id: document.getElementById('orderId').value.trim(),
      customer: document.getElementById('orderCustomer').value.trim(),
      date: document.getElementById('orderDate').value,
      assemblyLocation: document.getElementById('orderAssemblyLocation').value.trim() || null,
      status: document.getElementById('orderStatus').value,
      note: document.getElementById('orderNote').value.trim() || null,
      t34Passport: document.getElementById('orderT34Passport').checked,
      items: state.draftItems
    };

    const isEdit = document.getElementById('orderId').hasAttribute('readonly');

    try {
      await request(`/api/orders${isEdit ? `/${payload.id}` : ''}`, {
        method: isEdit ? 'PUT' : 'POST',
        body: JSON.stringify(payload)
      });

      event.target.reset();
      document.getElementById('orderId').removeAttribute('readonly');
      state.draftItems = [];
      renderDraftItems();
      await loadOrders();
      await showHistory(payload.id);
    } catch (error) {
      alert(error.message);
    }
  });

  ordersTable.addEventListener('click', async (event) => {
    const btn = event.target.closest('button');
    if (!btn) {
      return;
    }

    const { action, id } = btn.dataset;

    try {
      if (action === 'history') {
        await showHistory(id);
      }

      if (action === 'delete') {
        await request(`/api/orders/${id}`, { method: 'DELETE' });
        historyViewer.textContent = '';
        await loadOrders();
      }

      if (action === 'edit') {
        const orders = await request('/api/orders');
        const target = orders.find((ord) => ord.id === id);
        if (!target) {
          alert('Заказ не найден');
          return;
        }
        fillOrderForm(target);
      }
    } catch (error) {
      alert(error.message);
    }
  });

  document.getElementById('pickingForm').addEventListener('submit', async (event) => {
    event.preventDefault();

    const orderId = document.getElementById('pickingOrderId').value.trim();
    const itemId = document.getElementById('pickingItemId').value.trim();
    const pickedQuantity = Number(document.getElementById('pickingQuantity').value);

    try {
      await request(`/api/orders/${orderId}/items/${itemId}/pick`, {
        method: 'PUT',
        body: JSON.stringify({ pickedQuantity })
      });
      await loadOrders();
      await showHistory(orderId);
      event.target.reset();
    } catch (error) {
      alert(error.message);
    }
  });

  await loadWarehouse();
  await loadOrders();
}

init().catch((error) => {
  alert(error.message);
});
