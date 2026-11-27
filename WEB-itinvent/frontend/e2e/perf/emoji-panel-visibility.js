// Общая проверка CSS-видимости панели эмодзи для perf-harness'ов
// (#80 cold-open в chat-emoji-perf.spec.js, #88 warm reopen в
// chat-emoji-warm-reopen.spec.js).
//
// Зачем отдельный модуль: после фикса #88 keep-alive док скрывается
// visibility:hidden, а не display:none. Скрытый элемент СОХРАНЯЕТ геометрию —
// проверки по getBoundingClientRect()/offsetParent/размерам не отличают
// скрытую панель от видимой и дают ложноположительное «видно» на ещё
// закрытом доке (в warm reopen все стадии «измеряются» за ~0 мс). Корректный
// сигнал — computed visibility цепочки + непустая геометрия + непустая сетка.
//
// Оба harness'а ставят installEmojiPanelVisibility через addInitScript и
// вызывают window.__emojiVis.* внутри page.evaluate — реализация одна,
// байт-идентична в обоих замерах.

// ВНИМАНИЕ: функция сериализуется Playwright в страницу — обязана быть
// self-contained, без ссылок на внешний scope модуля.
export const installEmojiPanelVisibility = () => {
  const api = {
    // CSS-видимость: элемент реально рендерится (не выключен ни display:none
    // предка, ни visibility:hidden/collapse). visibility — наследуемое
    // свойство: computed-значение самого элемента уже учитывает предков
    // (переопределённый visibility:visible потомка — единственный способ
    // показать элемент внутри скрытого родителя, и тогда элемент действительно
    // виден). display цепочку проверяем обходом: display:none не наследуется,
    // но убирает весь layout поддерева.
    cssVisible(el) {
      if (!el || !(el instanceof Element)) return false;
      if (typeof el.checkVisibility === 'function') {
        return el.checkVisibility({ checkVisibilityCSS: true, checkOpacity: false });
      }
      const own = getComputedStyle(el).visibility;
      if (own === 'hidden' || own === 'collapse') return false;
      for (let node = el; node; node = node.parentElement) {
        if (getComputedStyle(node).display === 'none') return false;
      }
      return true;
    },
    // Непустая геометрия. Сама по себе НЕ доказывает видимость:
    // visibility:hidden элемент имеет полноценный rect.
    hasGeometry(el) {
      if (!el) return false;
      const rect = el.getBoundingClientRect();
      return rect.width > 0 && rect.height > 0;
    },
    // Геометрическое пересечение с viewport (без учёта клиппинга
    // scroll-контейнерами — приближение, достаточное для панели у края экрана).
    inViewport(el) {
      if (!el) return false;
      const rect = el.getBoundingClientRect();
      return rect.width > 0 && rect.height > 0
        && rect.bottom > 0 && rect.top < innerHeight
        && rect.right > 0 && rect.left < innerWidth;
    },
    // Видимость для пользователя: CSS-цепочка visible + непустая геометрия
    // + пересечение с viewport.
    userVisible(el) {
      return api.cssVisible(el) && api.inViewport(el);
    },
    dock() {
      return document.querySelector('[data-testid="chat-emoji-dock"]');
    },
    // Док реально показан пользователю. Возвращает сам элемент или null —
    // удобно и как предикат, и как accessor.
    visibleDock() {
      const dock = api.dock();
      return dock && api.userVisible(dock) ? dock : null;
    },
    // Кнопки сетки эмодзи внутри дока. Непустая сетка — отдельный сигнал:
    // виртуализация emoji-picker-react может держать сетку пустой даже
    // при смонтированном доке (обнулённые размеры, ещё не отмеренный viewport).
    emojiGridButtons(dock) {
      const scope = dock || api.dock();
      return scope ? [...scope.querySelectorAll('.EmojiPickerReact button.epr-emoji')] : [];
    },
    emojiSearchInput(dock) {
      const scope = dock || api.dock();
      return scope ? scope.querySelector('.EmojiPickerReact input') : null;
    },
    // Первый действительно видимый эмодзи: док виден, сетка непуста,
    // кнопка видима по CSS, имеет геометрию, не disabled.
    firstVisibleEmojiButton() {
      const dock = api.visibleDock();
      if (!dock) return null;
      const buttons = api.emojiGridButtons(dock);
      if (!buttons.length) return null;
      const button = buttons[0];
      if (button.disabled || !api.userVisible(button)) return null;
      return button;
    },
    // Поисковый input пикера, с которым пользователь реально может
    // взаимодействовать: виден по CSS, непустая геометрия, не disabled.
    interactiveSearchInput() {
      const dock = api.visibleDock();
      if (!dock) return null;
      const input = api.emojiSearchInput(dock);
      if (!input || input.disabled || !api.userVisible(input)) return null;
      return input;
    },
  };
  Object.defineProperty(window, '__emojiVis', { value: api, configurable: true });
};
