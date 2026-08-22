(function initializeRolePickerModule() {
  const roots = [...document.querySelectorAll('[data-role-picker]')];
  const mountPromises = new WeakMap();

  function usersFrom(payload) {
    const users = Array.isArray(payload) ? payload : Array.isArray(payload?.users) ? payload.users : [];
    return users.filter((user) => user && user.id !== undefined && user.id !== null && String(user.id).trim() && user.name && user.role);
  }

  function replacePlaceholder(select, text) {
    select.replaceChildren();
    const option = document.createElement('option');
    option.value = '';
    option.textContent = text;
    option.selected = true;
    select.append(option);
  }

  async function mountRoot(root) {
    const select = root.querySelector('[data-role-picker-select]');
    const state = root.querySelector('[data-role-picker-state]');
    if (!select || !state) return;

    root.dataset.state = 'loading';
    select.disabled = true;
    replacePlaceholder(select, 'AWAITING USER DATA');
    state.textContent = 'IDENTITY REQUIRED';

    try {
      const users = usersFrom(await window.RakshakAPI.loadUsers());
      if (!users.length) {
        root.dataset.state = 'empty';
        replacePlaceholder(select, 'NO USER DATA AVAILABLE');
        state.textContent = 'NO IDENTITIES RETURNED';
        return;
      }

      const usersById = new Map(users.map((user) => [String(user.id), user]));
      replacePlaceholder(select, 'SELECT USER');
      users.forEach((user) => {
        const option = document.createElement('option');
        option.value = String(user.id);
        option.textContent = `${user.name} · ${user.role}`;
        select.append(option);
      });

      const syncSelection = (user) => {
        const selectedId = user?.id === undefined || user?.id === null ? '' : String(user.id);
        select.value = usersById.has(selectedId) ? selectedId : '';
        root.dataset.state = select.value ? 'ready' : 'awaiting-selection';
        state.textContent = select.value ? 'IDENTITY ACTIVE' : 'SELECT IDENTITY';
      };

      select.addEventListener('change', () => {
        window.RakshakIdentity.setSelectedUser(usersById.get(select.value) || null);
      });
      window.RakshakIdentity.subscribe(syncSelection);

      const currentUser = window.RakshakIdentity.getSelectedUser();
      if (currentUser && !usersById.has(String(currentUser.id))) window.RakshakIdentity.setSelectedUser(null);
      else if (currentUser) {
        const verifiedUser = usersById.get(String(currentUser.id));
        if (verifiedUser.name !== currentUser.name || verifiedUser.role !== currentUser.role) window.RakshakIdentity.setSelectedUser(verifiedUser);
      }
      syncSelection(window.RakshakIdentity.getSelectedUser());
      select.disabled = false;
      root.dataset.usersLoaded = 'true';
    } catch {
      root.dataset.state = 'unavailable';
      replacePlaceholder(select, 'USER DATA UNAVAILABLE');
      state.textContent = 'ROLE SERVICE UNAVAILABLE';
    }
  }

  function mount(root) {
    if (root.dataset.usersLoaded === 'true') return Promise.resolve();
    const existing = mountPromises.get(root);
    if (existing) return existing;
    const promise = mountRoot(root).finally(() => mountPromises.delete(root));
    mountPromises.set(root, promise);
    return promise;
  }

  const refresh = () => Promise.all(roots.map(mount));
  const ready = refresh();
  window.RakshakRolePicker = Object.freeze({ ready, refresh });
}());
