import { useEffect, useId, useRef, useState } from 'react';
import ArrowForwardRoundedIcon from '@mui/icons-material/ArrowForwardRounded';
import ChatBubbleOutlineRoundedIcon from '@mui/icons-material/ChatBubbleOutlineRounded';
import CloseRoundedIcon from '@mui/icons-material/CloseRounded';
import ComputerRoundedIcon from '@mui/icons-material/ComputerRounded';
import ContactsOutlinedIcon from '@mui/icons-material/ContactsOutlined';
import DescriptionOutlinedIcon from '@mui/icons-material/DescriptionOutlined';
import FitScreenRoundedIcon from '@mui/icons-material/FitScreenRounded';
import FolderOpenRoundedIcon from '@mui/icons-material/FolderOpenRounded';
import ForumOutlinedIcon from '@mui/icons-material/ForumOutlined';
import GroupsOutlinedIcon from '@mui/icons-material/GroupsOutlined';
import LanRoundedIcon from '@mui/icons-material/LanRounded';
import MailOutlineRoundedIcon from '@mui/icons-material/MailOutlineRounded';
import MenuBookRoundedIcon from '@mui/icons-material/MenuBookRounded';
import NotificationsNoneRoundedIcon from '@mui/icons-material/NotificationsNoneRounded';
import OpenInFullRoundedIcon from '@mui/icons-material/OpenInFullRounded';
import PrintOutlinedIcon from '@mui/icons-material/PrintOutlined';
import SecurityRoundedIcon from '@mui/icons-material/SecurityRounded';
import TaskAltRoundedIcon from '@mui/icons-material/TaskAltRounded';
import VerifiedUserOutlinedIcon from '@mui/icons-material/VerifiedUserOutlined';
import DesktopInstallerDownload from '../components/desktop/DesktopInstallerDownload';
import { authAPI } from '../api/client';
import { useAuth } from '../contexts/AuthContext';
import { resolveAfterAboutOnboardingPath } from '../lib/aboutOnboarding';
import { useNavigate } from 'react-router-dom';
import './About.css';

const CAPABILITIES = [
  {
    icon: ChatBubbleOutlineRoundedIcon,
    title: 'Общение',
    text: 'Личные и групповые чаты, почта, уведомления и адресная книга в одном рабочем пространстве.',
    items: ['Личные и групповые чаты', 'Почта и уведомления', 'Адресная книга'],
  },
  {
    icon: TaskAltRoundedIcon,
    title: 'Работа',
    text: 'В каждой задаче собраны сроки, участники, обсуждение, чек-лист и нужные документы.',
    items: ['Задачи и обсуждения', 'Документы и файлы', 'Просмотр и печать'],
  },
  {
    icon: ComputerRoundedIcon,
    title: 'IT-сервисы',
    text: 'Учёт техники, компьютеры, сети, база знаний и другие инструменты — с учётом рабочих прав сотрудника.',
    items: ['Техника и компьютеры', 'Сети и база знаний', 'Инструменты по рабочим правам'],
  },
];

const WORKDAY_STEPS = [
  ['01', 'Получить уведомление', 'HUB сообщит о новом письме, сообщении или изменении задачи.'],
  ['02', 'Обсудить вопрос', 'Ответьте в личном или групповом чате либо продолжите обсуждение внутри задачи.'],
  ['03', 'Выполнить задачу', 'Описание, сроки, участники, чек-лист и файлы находятся в одной карточке.'],
  ['04', 'Открыть документ', 'Просмотрите или скачайте файл. В HUB Desktop его можно открыть в привычной программе и распечатать.'],
];

const TOOLS = [
  {
    id: 'mail',
    label: 'Почта',
    icon: MailOutlineRoundedIcon,
    title: 'Почта без переключения между окнами',
    description: 'Читайте переписку, работайте с вложениями и сразу переходите к связанным действиям.',
    src: '/about/mail-desktop-dark@2x.png',
    alt: 'Почта HUB-IT в тёмной теме с тестовой перепиской и списком писем',
    caption: 'Почта HUB-IT · обезличенная тестовая переписка',
  },
  {
    id: 'files',
    label: 'Файлы',
    icon: FolderOpenRoundedIcon,
    title: 'Рабочие файлы всегда под рукой',
    description: 'Храните материалы, скачивайте их или открывайте в установленных приложениях через HUB Desktop.',
    src: '/about/files-desktop-dark@2x.png',
    alt: 'Раздел файлов HUB-IT в тёмной теме с тестовыми документами',
    caption: 'Мой диск · три безопасных тестовых документа',
  },
  {
    id: 'contacts',
    label: 'Адресная книга',
    icon: ContactsOutlinedIcon,
    title: 'Коллеги и способы связи в одном месте',
    description: 'Найдите человека по имени, отделу или контакту и сразу выберите подходящий канал связи.',
    src: '/about/address-book-desktop-dark@2x.png',
    mobileSrc: '/about/address-book-mobile-dark@3x.png',
    alt: 'Адресная книга HUB-IT в тёмной теме с вымышленными контактами',
    caption: 'Адресная книга · только вымышленные сотрудники и контакты',
  },
];

const MOBILE_SCREENS = [
  {
    title: 'Главная',
    text: 'Задачи, уведомления, связь и информация об отсутствующих коллегах.',
    src: '/about/dashboard-mobile-dark@3x.png',
    width: 1170,
    height: 2532,
    alt: 'Мобильная главная HUB-IT в тёмной теме с задачами и двумя отсутствующими сотрудниками',
  },
  {
    title: 'Групповой чат',
    text: 'Сообщения, ответы и реакции проектной команды.',
    src: '/about/chat-mobile-dark@3x.png',
    width: 1170,
    height: 2532,
    alt: 'Мобильный групповой чат HUB-IT в тёмной теме с тестовой перепиской',
  },
  {
    title: 'Задача',
    text: 'Описание, участники, чек-лист и обсуждение.',
    src: '/about/task-mobile-dark@3x.png',
    width: 1170,
    height: 2532,
    alt: 'Мобильная карточка задачи HUB-IT в тёмной теме с тестовыми данными',
  },
  {
    title: 'Меню',
    text: 'Только разделы, доступные обычному сотруднику.',
    src: '/about/menu-mobile-dark@3x.png',
    width: 1170,
    height: 2532,
    alt: 'Мобильное меню HUB-IT в тёмной теме с разделами обычного сотрудника без административных инструментов',
  },
];

const DESKTOP_FEATURES = [
  [NotificationsNoneRoundedIcon, 'Уведомления приходят, даже когда окно свёрнуто'],
  [ComputerRoundedIcon, 'Быстрый доступ из области уведомлений и запуск вместе с Windows'],
  [PrintOutlinedIcon, 'Открытие и печать файлов в установленных приложениях'],
  [VerifiedUserOutlinedIcon, 'Автоматическая проверка и установка безопасных обновлений'],
];

const SECURITY_FEATURES = [
  [VerifiedUserOutlinedIcon, 'Корпоративная учётная запись'],
  [SecurityRoundedIcon, 'Пароль, проверочный код или ключ доступа'],
  [LanRoundedIcon, 'Защищённое соединение'],
  [MenuBookRoundedIcon, 'Доступ только к нужным разделам'],
];

function ProductShot({
  desktopSrc,
  mobileSrc,
  alt,
  caption,
  desktopWidth = 2880,
  desktopHeight = 1800,
  mobileWidth = 1170,
  mobileHeight = 2532,
  priority = false,
  type = 'desktop',
  className = '',
  showCaption = true,
}) {
  const dialogRef = useRef(null);
  const triggerRef = useRef(null);
  const titleId = useId();
  const [zoom, setZoom] = useState('fit');
  const desktopOneXSrc = desktopSrc.endsWith('@2x.png')
    ? desktopSrc.replace('@2x.png', '.png')
    : desktopSrc;
  const desktopMediumSrc = desktopSrc.endsWith('@2x.png')
    ? desktopSrc.replace('@2x.png', '@1920w.png')
    : null;
  const desktopSrcSet = desktopMediumSrc
    ? `${desktopOneXSrc} 1440w, ${desktopMediumSrc} 1920w, ${desktopSrc} ${desktopWidth}w`
    : `${desktopSrc} ${desktopWidth}w`;

  const openViewer = () => {
    setZoom('fit');
    const dialog = dialogRef.current;
    if (!dialog) return;
    if (typeof dialog.showModal === 'function') dialog.showModal();
    else dialog.setAttribute('open', '');
  };

  const closeViewer = () => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    if (typeof dialog.close === 'function') dialog.close();
    else dialog.removeAttribute('open');
    triggerRef.current?.focus();
  };

  const picture = (viewer = false) => (
    <picture>
      {mobileSrc ? (
        <source
          media="(max-width: 719px)"
          srcSet={`${mobileSrc} ${mobileWidth}w`}
          sizes={viewer ? '100vw' : '(max-width: 719px) calc(100vw - 32px)'}
          width={mobileWidth}
          height={mobileHeight}
        />
      ) : null}
      <img
        src={desktopSrc}
        srcSet={desktopSrcSet}
        sizes={viewer ? '100vw' : '(max-width: 719px) calc(100vw - 32px), (max-width: 1480px) calc(100vw - 40px), 1440px'}
        width={desktopWidth}
        height={desktopHeight}
        alt={viewer ? '' : alt}
        loading={priority ? 'eager' : 'lazy'}
        decoding="async"
        fetchpriority={priority ? 'high' : 'auto'}
      />
    </picture>
  );

  return (
    <figure className={`about-shot about-shot--${type} ${className}`.trim()}>
      <button
        ref={triggerRef}
        type="button"
        className="about-shot__open"
        onClick={openViewer}
        aria-label={`Увеличить изображение: ${caption}`}
      >
        {picture()}
        <span className="about-shot__zoom" aria-hidden="true">
          <OpenInFullRoundedIcon fontSize="small" />
        </span>
      </button>
      {showCaption ? <figcaption>{caption}</figcaption> : null}

      <dialog
        ref={dialogRef}
        className={`about-viewer about-viewer--${zoom}`}
        aria-labelledby={titleId}
        onCancel={(event) => {
          event.preventDefault();
          closeViewer();
        }}
        onClose={() => triggerRef.current?.focus()}
      >
        <div className="about-viewer__toolbar">
          <p id={titleId}>{caption}</p>
          <div className="about-viewer__actions">
            <button
              type="button"
              aria-pressed={zoom === 'fit'}
              onClick={() => setZoom('fit')}
            >
              <FitScreenRoundedIcon fontSize="small" aria-hidden="true" />
              По размеру
            </button>
            <button
              type="button"
              aria-pressed={zoom === 'actual'}
              onClick={() => setZoom('actual')}
            >
              100%
            </button>
            <button type="button" onClick={closeViewer} aria-label="Закрыть просмотр">
              <CloseRoundedIcon aria-hidden="true" />
            </button>
          </div>
        </div>
        <div className="about-viewer__canvas">{picture(true)}</div>
      </dialog>
    </figure>
  );
}

export default function About({ mode = 'onboarding' }) {
  const embedded = mode === 'embedded';
  const navigate = useNavigate();
  const { refreshSession } = useAuth();
  const [activeTool, setActiveTool] = useState(TOOLS[0].id);
  const [completing, setCompleting] = useState(false);
  const [completionError, setCompletionError] = useState('');
  const selectedTool = TOOLS.find((tool) => tool.id === activeTool) ?? TOOLS[0];

  const handleContinue = async () => {
    if (embedded || completing) return;
    setCompleting(true);
    setCompletionError('');
    try {
      await authAPI.completeAboutOnboarding();
      await refreshSession({ suppressAuthRequired: true });
      navigate(resolveAfterAboutOnboardingPath(), { replace: true });
    } catch {
      setCompletionError('Не удалось сохранить. Проверьте подключение и повторите попытку.');
      setCompleting(false);
    }
  };

  const handleToolKeyDown = (event, currentIndex) => {
    let nextIndex = null;
    if (event.key === 'ArrowRight') nextIndex = (currentIndex + 1) % TOOLS.length;
    if (event.key === 'ArrowLeft') nextIndex = (currentIndex - 1 + TOOLS.length) % TOOLS.length;
    if (event.key === 'Home') nextIndex = 0;
    if (event.key === 'End') nextIndex = TOOLS.length - 1;
    if (nextIndex === null) return;

    event.preventDefault();
    const nextTool = TOOLS[nextIndex];
    setActiveTool(nextTool.id);
    window.requestAnimationFrame(() => document.getElementById(`about-tab-${nextTool.id}`)?.focus());
  };

  useEffect(() => {
    if (embedded) return undefined;
    const previousTitle = document.title;
    let robots = document.querySelector('meta[name="robots"]');
    const createdRobots = !robots;
    const previousRobots = robots?.getAttribute('content');

    if (!robots) {
      robots = document.createElement('meta');
      robots.setAttribute('name', 'robots');
      document.head.appendChild(robots);
    }

    document.title = 'HUB-IT — единое рабочее пространство';
    robots.setAttribute('content', 'noindex, nofollow');

    return () => {
      document.title = previousTitle;
      if (createdRobots) robots.remove();
      else if (previousRobots === null) robots.removeAttribute('content');
      else robots.setAttribute('content', previousRobots);
    };
  }, [embedded]);

  const continueButton = !embedded ? (
    <button
      type="button"
      className="about-button about-button--primary"
      onClick={() => { void handleContinue(); }}
      disabled={completing}
    >
      {completing ? 'Сохраняем…' : 'Перейти в HUB'}
      <ArrowForwardRoundedIcon fontSize="small" aria-hidden="true" />
    </button>
  ) : null;

  const ContentRoot = embedded ? 'div' : 'main';

  return (
    <div className={`about-page${embedded ? ' about-page--embedded' : ''}`}>
      {!embedded ? <a className="about-skip-link" href="#about-main">Перейти к содержанию</a> : null}

      {!embedded ? <header className="about-header">
        <div className="about-shell about-header__inner">
          <a className="about-brand" href="#about-main" aria-label="HUB-IT — перейти к началу знакомства">
            <img src="/favicon.png" alt="" width="34" height="34" />
            <span>HUB-IT</span>
          </a>
          <nav className="about-nav" aria-label="Разделы страницы">
            <a href="#possibilities">Возможности</a>
            <a href="#collaboration">Общение</a>
            <a href="#mobile">На телефоне</a>
            <a href="#desktop">Для Windows</a>
          </nav>
          <button type="button" className="about-header__login" onClick={() => { void handleContinue(); }} disabled={completing}>
            Перейти в HUB
          </button>
        </div>
      </header> : null}

      <ContentRoot id="about-main">
        <section className="about-hero about-shell" aria-labelledby="about-title">
          <div className="about-hero__copy">
            <p className="about-eyebrow"><span aria-hidden="true" />Корпоративная платформа</p>
            <h1 id="about-title">Все рабочие сервисы — <span>в одном HUB</span></h1>
            <p className="about-hero__lead">
              Общайтесь, решайте задачи, работайте с почтой, документами и IT-сервисами
              в едином защищённом пространстве.
            </p>
            <div className="about-hero__actions">
              {continueButton}
              <DesktopInstallerDownload variant="hero" />
            </div>
            {!embedded ? (
              <p className="about-completion-error" role="alert" aria-live="assertive">
                {completionError}
              </p>
            ) : null}
            <ul className="about-hero__facts" aria-label="Ключевые особенности">
              <li>Работает в браузере и на телефоне</li>
              <li>Есть приложение для Windows</li>
              <li>Доступ зависит от рабочих прав</li>
            </ul>
          </div>

          <ProductShot
            desktopSrc="/about/dashboard-desktop-dark@2x.png"
            mobileSrc="/about/dashboard-mobile-dark@3x.png"
            mobileHeight={2532}
            alt="Главная страница HUB-IT в тёмной теме с тестовой задачей, уведомлениями и двумя отсутствующими сотрудниками"
            caption="Главная страница HUB-IT с задачами, уведомлениями и информацией об отсутствующих коллегах"
            priority
            className="about-hero__shot"
          />
        </section>

        <section id="possibilities" className="about-section about-shell" aria-labelledby="possibilities-title">
          <div className="about-section-heading">
            <p className="about-kicker">Всё нужное рядом</p>
            <h2 id="possibilities-title">Всё для работы — под одной учётной записью</h2>
            <p>В HUB не нужно открывать несколько разрозненных сервисов: основные рабочие инструменты собраны в одном интерфейсе.</p>
          </div>
          <div className="about-capabilities">
            {CAPABILITIES.map(({ icon: Icon, title, text, items }) => (
              <article key={title} className="about-capability">
                <span className="about-capability__icon" aria-hidden="true"><Icon /></span>
                <h3>{title}</h3>
                <p>{text}</p>
                <ul>
                  {items.map((item) => <li key={item}>{item}</li>)}
                </ul>
              </article>
            ))}
          </div>
        </section>

        <section className="about-section about-section--workday" aria-labelledby="workday-title">
          <div className="about-shell">
            <div className="about-section-heading about-section-heading--left">
              <p className="about-kicker">Один рабочий день</p>
              <h2 id="workday-title">От нового сообщения до выполненной задачи</h2>
            </div>
            <ol className="about-workday">
              {WORKDAY_STEPS.map(([number, title, text]) => (
                <li key={number}>
                  <span>{number}</span>
                  <h3>{title}</h3>
                  <p>{text}</p>
                </li>
              ))}
            </ol>
          </div>
        </section>

        <section id="collaboration" className="about-section about-shell about-feature" aria-labelledby="chat-title">
          <div className="about-feature__copy">
            <p className="about-kicker">Корпоративный чат</p>
            <h2 id="chat-title">Личные беседы и групповые чаты</h2>
            <p>
              Создайте общий чат для команды, отвечайте на конкретные сообщения,
              используйте реакции и сохраняйте историю обсуждения.
            </p>
            <ul className="about-check-list">
              <li><GroupsOutlinedIcon aria-hidden="true" />Групповые чаты с участниками</li>
              <li><ForumOutlinedIcon aria-hidden="true" />Ответы и реакции на сообщения</li>
              <li><NotificationsNoneRoundedIcon aria-hidden="true" />Уведомления о новых сообщениях</li>
            </ul>
          </div>
          <ProductShot
            desktopSrc="/about/chat-group-desktop-dark@2x.png"
            mobileSrc="/about/chat-mobile-dark@3x.png"
            alt="Групповой чат HUB-IT в тёмной теме с вымышленной проектной командой и тестовой перепиской"
            caption="Групповой чат с ответами на сообщения и реакциями"
          />
        </section>

        <section className="about-section about-shell about-feature about-feature--reverse" aria-labelledby="tasks-title">
          <div className="about-feature__copy">
            <p className="about-kicker">Задачи и обсуждение</p>
            <h2 id="tasks-title">Диалог, чек-лист и материалы внутри задачи</h2>
            <p>
              Описание, сроки, участники, файлы и обсуждение собраны в одной карточке.
              Не нужно искать связанные сообщения в почте и отдельных чатах.
            </p>
            <ul className="about-check-list">
              <li><TaskAltRoundedIcon aria-hidden="true" />Статус, срок и ответственные</li>
              <li><ChatBubbleOutlineRoundedIcon aria-hidden="true" />Обсуждение по конкретной задаче</li>
              <li><DescriptionOutlinedIcon aria-hidden="true" />Чек-лист и вложенные документы</li>
            </ul>
          </div>
          <ProductShot
            desktopSrc="/about/task-discussion-desktop-dark@2x.png"
            mobileSrc="/about/task-mobile-dark@3x.png"
            alt="Задача HUB-IT в тёмной теме с обсуждением, чек-листом и тестовым вложением"
            caption="Карточка задачи с обсуждением, чек-листом и вложением"
          />
        </section>

        <section className="about-section about-section--tools" aria-labelledby="tools-title">
          <div className="about-shell">
            <div className="about-section-heading">
              <p className="about-kicker">Рабочие инструменты</p>
              <h2 id="tools-title">Почта, файлы и адресная книга</h2>
              <p>Выберите раздел, чтобы увидеть, как он выглядит в HUB.</p>
            </div>

            <div className="about-tool-tabs" role="tablist" aria-label="Рабочие инструменты HUB-IT">
              {TOOLS.map(({ id, label, icon: Icon }, index) => (
                <button
                  key={id}
                  id={`about-tab-${id}`}
                  type="button"
                  role="tab"
                  aria-selected={activeTool === id}
                  aria-controls="about-tool-panel"
                  tabIndex={activeTool === id ? 0 : -1}
                  onClick={() => setActiveTool(id)}
                  onKeyDown={(event) => handleToolKeyDown(event, index)}
                >
                  <Icon fontSize="small" aria-hidden="true" />
                  {label}
                </button>
              ))}
            </div>

            <div
              id="about-tool-panel"
              className="about-tool-panel"
              role="tabpanel"
              aria-labelledby={`about-tab-${selectedTool.id}`}
            >
              <div className="about-tool-panel__copy">
                <h3>{selectedTool.title}</h3>
                <p>{selectedTool.description}</p>
              </div>
              <ProductShot
                key={selectedTool.id}
                desktopSrc={selectedTool.src}
                mobileSrc={selectedTool.mobileSrc}
                alt={selectedTool.alt}
                caption={selectedTool.caption}
              />
            </div>
          </div>
        </section>

        <section id="mobile" className="about-section about-shell" aria-labelledby="mobile-title">
          <div className="about-section-heading">
            <p className="about-kicker">HUB на телефоне</p>
            <h2 id="mobile-title">HUB адаптируется к экрану телефона</h2>
            <p>Откройте HUB в мобильном браузере: задачи, чаты, почта и другие доступные разделы останутся под рукой.</p>
            <p className="about-data-note">На всех экранах показаны вымышленные сотрудники и тестовые данные.</p>
          </div>
          <div className="about-mobile-gallery">
            {MOBILE_SCREENS.map((screen) => (
              <article key={screen.title} className="about-mobile-card">
                <div>
                  <h3>{screen.title}</h3>
                  <p>{screen.text}</p>
                </div>
                <ProductShot
                  desktopSrc={screen.src}
                  desktopWidth={screen.width}
                  desktopHeight={screen.height}
                  alt={screen.alt}
                  caption={`${screen.title} · мобильная версия HUB-IT`}
                  type="phone"
                  showCaption={false}
                />
              </article>
            ))}
          </div>
        </section>

        <section id="desktop" className="about-section about-section--desktop" aria-labelledby="desktop-title">
          <div className="about-shell">
            <div className="about-desktop-layout">
              <div className="about-feature__copy">
                <p className="about-kicker">HUB Desktop для Windows</p>
                <h2 id="desktop-title">HUB в отдельном приложении для Windows</h2>
                <p>
                  Работайте с HUB в отдельном окне, получайте системные уведомления,
                  открывайте файлы в установленных программах и запускайте приложение вместе с Windows.
                </p>
                <ul className="about-check-list about-check-list--desktop">
                  {DESKTOP_FEATURES.map(([Icon, text]) => (
                    <li key={text}><Icon aria-hidden="true" />{text}</li>
                  ))}
                </ul>
                <DesktopInstallerDownload variant="section" />
              </div>
              <ProductShot
                desktopSrc="/about/hub-desktop-window-dark.png"
                desktopWidth={2400}
                desktopHeight={1300}
                alt="Окно HUB Desktop для Windows в тёмной теме с тестовой учётной записью"
                caption="HUB Desktop в отдельном окне Windows"
                type="native"
              />
            </div>

            <div className="about-desktop-details" aria-label="Системные возможности HUB Desktop">
              <article>
                <div><h3>Уведомление с быстрым ответом</h3><p>Последнее уведомление не исчезает само: из него можно сразу ответить на сообщение.</p></div>
                <ProductShot
                  desktopSrc="/about/hub-desktop-notification.png"
                  desktopWidth={372}
                  desktopHeight={175}
                  alt="Тёмное уведомление HUB Desktop о сообщении в проектном чате с кнопкой «Ответить»"
                  caption="Уведомление HUB Desktop с кнопкой «Ответить»"
                  type="fragment"
                />
              </article>
              <article>
                <div><h3>Быстрый доступ из области уведомлений</h3><p>Откройте HUB, включите тихий режим или перейдите к настройкам через значок рядом с часами.</p></div>
                <ProductShot
                  desktopSrc="/about/hub-desktop-tray-menu.png"
                  desktopWidth={270}
                  desktopHeight={174}
                  alt="Тёмное меню HUB Desktop в области уведомлений Windows с быстрым переходом, тихим режимом и настройками"
                  caption="Меню HUB Desktop в области уведомлений Windows"
                  type="fragment"
                />
              </article>
              <article>
                <div><h3>Действия с файлами</h3><p>Документы DOCX, PDF и XLSX можно просмотреть, скачать, открыть или распечатать.</p></div>
                <ProductShot
                  desktopSrc="/about/files-desktop-dark@2x.png"
                  alt="Экран файлов HUB-IT в тёмной теме с тестовыми DOCX, PDF и XLSX и действиями над файлами"
                  caption="Файлы и действия · обезличенные тестовые DOCX, PDF и XLSX"
                  type="fragment-wide"
                />
              </article>
            </div>
          </div>
        </section>

        <section id="security" className="about-section about-shell about-security" aria-labelledby="security-title">
          <div className="about-security__copy">
            <p className="about-kicker">Безопасность и доступ</p>
            <h2 id="security-title">Доступ к разделам зависит от роли</h2>
            <p>
              В HUB сотрудники входят с корпоративной учётной записью. Дополнительную защиту
              обеспечивают проверочный код или ключ доступа — подтверждение по PIN-коду либо
              биометрии. Роль сотрудника определяет доступные разделы и данные.
            </p>
          </div>
          <ul className="about-security__items">
            {SECURITY_FEATURES.map(([Icon, text]) => (
              <li key={text}><Icon aria-hidden="true" /><span>{text}</span></li>
            ))}
          </ul>
        </section>

        <section className="about-final about-shell" aria-labelledby="final-title">
          <div>
            <p className="about-kicker">Начните работу</p>
            <h2 id="final-title">Откройте своё рабочее пространство</h2>
            <p>Войдите в браузере или установите HUB Desktop на компьютер с Windows 10/11 x64.</p>
          </div>
          <div className="about-final__actions">
            {continueButton}
            <DesktopInstallerDownload variant="final" />
          </div>
        </section>
      </ContentRoot>

      {!embedded ? <footer className="about-footer">
        <div className="about-shell">
          <a className="about-brand" href="#about-main">
            <img src="/favicon.png" alt="" width="30" height="30" />
            <span>HUB-IT</span>
          </a>
          <p>Единое рабочее пространство компании</p>
          <button type="button" onClick={() => { void handleContinue(); }} disabled={completing}>Перейти в HUB</button>
        </div>
      </footer> : null}
    </div>
  );
}
