# -*- coding: utf-8 -*-
"""Вносит редактируемые тексты (TextService) в модуль zsgp.oneboat."""
import io, os, sys

BASE = r"C:\Project\Image_scan\one-boat-bitrix-build-staging\package\local\modules\zsgp.oneboat"

TEXTSERVICE = '''<?php

declare(strict_types=1);

namespace Zsgp\\OneBoat\\Service;

use Bitrix\\Main\\Config\\Option;

/**
 * Тексты публичных страниц конкурса.
 *
 * Хранение: модульная опция page_texts (JSON с переопределениями).
 * Пустое значение в админке = дефолт из FIELDS.
 */
final class TextService
{
    public const OPTION_NAME = 'page_texts';

    /**
     * key => [группа, подпись в админке, значение по умолчанию, многострочное]
     */
    private const FIELDS = [
        'BTN_REGISTER' => ['shared', 'Кнопка «Регистрация»', 'Регистрация'],
        'BTN_MY_TEAM' => ['shared', 'Кнопка «Перейти к моей команде»', 'Перейти к моей команде'],
        'BTN_TEAMS' => ['shared', 'Кнопка «Смотреть команды и рейтинг»', 'Смотреть команды и рейтинг'],
        'BTN_RULES' => ['shared', 'Кнопка «Условия конкурса»', 'Условия конкурса'],
        'BTN_OPEN_TEAMS' => ['shared', 'Кнопка «Открыть команды»', 'Открыть команды'],
        'BTN_CANCEL' => ['shared', 'Кнопка «Отмена»', 'Отмена'],
        'BTN_CONFIRM_JOIN' => ['shared', 'Кнопка «Зарегистрироваться»', 'Зарегистрироваться'],
        'BTN_REGULATION' => ['shared', 'Кнопка положения конкурса', 'ПОЛОЖЕНИЕ КОНКУРСА'],
        'BTN_VOTE' => ['shared', 'Кнопка «Голосовать»', 'Голосовать'],
        'BTN_OWN_TEAM' => ['shared', 'Кнопка на своей команде', 'Своя команда'],
        'BTN_TEAM_DETAILS' => ['shared', 'Кнопка «О команде»', 'О команде'],
        'CONTACT_PREFIX' => ['shared', 'Подпись перед контактом', 'Вопросы:'],
        'REGULATION_HINT' => ['shared', 'Подсказка у неактивной кнопки положения', 'Ссылка появится после загрузки скана'],
        'SELF_VOTE_HINT' => ['shared', 'Подсказка «за свою команду нельзя»', 'За свою команду голосовать нельзя'],
        'LANDING_KICKER' => ['landing', 'Плашка над заголовком', 'Корпоративный командный конкурс'],
        'CHIP_TEAMS_SUFFIX' => ['landing', 'Суффикс счётчика команд на корабле', 'экипажей'],
        'CHIP_ROUTE' => ['landing', 'Плашка «общий курс»', 'общий курс'],
        'MOTION_HINT' => ['landing', 'Подсказка под кораблём', 'Двигайте курсором'],
        'FACTS_ARIA' => ['landing', 'Название блока фактов (для читалок)', 'Ключевые особенности конкурса'],
        'FACT1_SUFFIX' => ['landing', 'Факт 1: слово после числа команд', 'команд'],
        'FACT1_SUB' => ['landing', 'Факт 1: подпись', 'равное распределение'],
        'FACT2_TITLE' => ['landing', 'Факт 2: заголовок', '1 общий маршрут'],
        'FACT2_SUB' => ['landing', 'Факт 2: подпись', 'от идеи к результату'],
        'FACT3_TITLE' => ['landing', 'Факт 3: заголовок', '1 голос в день'],
        'FACT3_SUB' => ['landing', 'Факт 3: подпись', 'после верного ответа'],
        'STAGES_KICKER' => ['landing', 'Этапы: плашка', 'Календарь конкурса'],
        'STAGES_TITLE' => ['landing', 'Этапы: заголовок', 'Маршрут по этапам'],
        'ABOUT_KICKER' => ['landing', 'О конкурсе: плашка', 'О конкурсе'],
        'ABOUT_TITLE' => ['landing', 'О конкурсе: заголовок', 'Вместе прокладываем маршрут к лучшим идеям'],
        'STEPS_KICKER' => ['landing', 'Шаги: плашка', 'Как всё устроено'],
        'STEPS_TITLE' => ['landing', 'Шаги: заголовок', 'Три шага в одном направлении'],
        'STEP1_TITLE' => ['landing', 'Шаг 1: заголовок', 'Войти в команду'],
        'STEP1_TEXT' => ['landing', 'Шаг 1: текст', 'Подтвердите участие — система равномерно распределит вас случайным образом.', true],
        'STEP2_TITLE' => ['landing', 'Шаг 2: заголовок', 'Подготовить проект'],
        'STEP2_TEXT' => ['landing', 'Шаг 2: текст', 'Познакомьтесь с экипажем, объедините опыт и раскройте идею команды.', true],
        'STEP3_TITLE' => ['landing', 'Шаг 3: заголовок', 'Поддержать лучших'],
        'STEP3_TEXT' => ['landing', 'Шаг 3: текст', 'Отвечайте на один вопрос в день и отдавайте голос выбранной команде.', true],
        'FINAL_KICKER' => ['landing', 'Финальный блок: плашка', 'Все на борт'],
        'FINAL_TITLE' => ['landing', 'Финальный блок: заголовок', 'Большой результат начинается с одного шага'],
        'FINAL_TEXT' => ['landing', 'Финальный блок: текст', 'Ваша команда уже ждёт. Присоединяйтесь и помогите общему проекту набрать ход.', true],
        'RULES_KICKER' => ['landing', 'Правила: плашка', 'Условия'],
        'RULES_TITLE' => ['landing', 'Правила: заголовок', 'Правила на борту'],
        'JOIN_KICKER' => ['landing', 'Диалог регистрации: плашка', 'Подтверждение'],
        'JOIN_TITLE' => ['landing', 'Диалог регистрации: заголовок', 'Готовы зарегистрироваться?'],
        'JOIN_TEXT' => ['landing', 'Диалог регистрации: текст', 'После подтверждения система назначит вас в одну из самых малочисленных команд с доступным местом.', true],
        'DRAW_KICKER' => ['landing', 'Жеребьёвка: плашка', 'Жеребьёвка'],
        'DRAW_TITLE' => ['landing', 'Жеребьёвка: заголовок', 'Определяем ваш экипаж'],
        'DRAW_TEXT' => ['landing', 'Жеребьёвка: текст', 'Распределение выполняется на сервере между самыми малочисленными командами. Анимация только показывает уже сохранённый результат.', true],
        'DRAW_TEAM_LABEL' => ['landing', 'Жеребьёвка: подпись результата', 'Ваша команда'],
        'DASH_BACK' => ['dashboard', 'Ссылка назад на лендинг', '← О конкурсе'],
        'DASH_KICKER' => ['dashboard', 'Шапка: плашка', 'Команды конкурса'],
        'DASH_TITLE' => ['dashboard', 'Шапка: заголовок', 'В одной лодке'],
        'DASH_SUBTITLE' => ['dashboard', 'Шапка: подзаголовок', 'Откройте карточку, познакомьтесь с проектом и поддержите команду в период голосования.', true],
        'MY_TEAM_LABEL' => ['dashboard', 'Плашка «Ваша команда»', 'Ваша команда'],
        'MY_TEAM_PROVISIONAL' => ['dashboard', 'Плашка «Предварительная команда»', 'Предварительная команда'],
        'CREW_KICKER' => ['dashboard', 'Список команд: плашка', 'Наши экипажи'],
        'CREW_TITLE' => ['dashboard', 'Список команд: заголовок', 'Выберите команду'],
        'VOTE_DONE' => ['dashboard', 'Статус: уже голосовали', 'Сегодня вы уже проголосовали'],
        'VOTE_USED' => ['dashboard', 'Статус: попытка использована', 'Сегодняшняя попытка уже использована'],
        'VOTE_AVAILABLE' => ['dashboard', 'Статус: голос доступен', 'Сегодня доступен один голос'],
        'VOTE_CLOSED' => ['dashboard', 'Статус: голосование закрыто', 'Голосование сейчас закрыто'],
        'OWN_TEAM_BADGE' => ['dashboard', 'Метка на своей команде', 'Вы в этой команде'],
        'OWN_TEAM_SUFFIX' => ['dashboard', 'Метка «предварительно»', ' · предварительно'],
        'TEAM_PREFIX' => ['dashboard', 'Номер карточки: слово перед номером', 'Команда'],
        'EMBLEM_ALT' => ['dashboard', 'Alt эмблемы (%s — название команды)', 'Эмблема команды «%s»'],
        'RATING_KICKER' => ['dashboard', 'Рейтинг: плашка', 'Общий результат'],
        'RATING_TITLE' => ['dashboard', 'Рейтинг: заголовок', 'Рейтинг команд'],
        'RATING_NOTE' => ['dashboard', 'Рейтинг: примечание', 'Обновляется автоматически раз в минуту'],
        'REG_KICKER' => ['dashboard', 'Диалог входа: плашка', 'Регистрация'],
        'REG_TITLE' => ['dashboard', 'Диалог входа: заголовок', 'Войти в команду?'],
        'REG_TEXT' => ['dashboard', 'Диалог входа: текст', 'После подтверждения система автоматически назначит вас в команду, где есть свободное место.', true],
    ];

    private const GROUP_LABELS = [
        'shared' => 'Общие кнопки и подписи',
        'landing' => 'Лендинг',
        'dashboard' => 'Страница команд',
    ];

    /** Все тексты: дефолты + переопределения из опций. */
    public function get(): array
    {
        $overrides = $this->overrides();
        $texts = [];
        foreach (self::FIELDS as $key => $meta) {
            $texts[$key] = $overrides[$key] ?? $meta[2];
        }
        return $texts;
    }

    /** Метаданные для админской формы. */
    public function describe(): array
    {
        $overrides = $this->overrides();
        $result = [];
        foreach (self::FIELDS as $key => $meta) {
            $result[$key] = [
                'group' => $meta[0],
                'group_label' => self::GROUP_LABELS[$meta[0]] ?? $meta[0],
                'label' => $meta[1],
                'default' => $meta[2],
                'multiline' => !empty($meta[3]),
                'value' => $overrides[$key] ?? $meta[2],
            ];
        }
        return $result;
    }

    /** Сохраняет переопределения; пустые и равные дефолту значения не хранятся. */
    public function save(array $input): void
    {
        $overrides = [];
        foreach (self::FIELDS as $key => $meta) {
            if (!array_key_exists($key, $input)) {
                continue;
            }
            $value = trim((string) $input[$key]);
            if ($value !== '' && $value !== $meta[2]) {
                $overrides[$key] = $value;
            }
        }
        if ($overrides === []) {
            Option::delete('zsgp.oneboat', ['name' => self::OPTION_NAME]);
            return;
        }
        Option::set('zsgp.oneboat', self::OPTION_NAME, json_encode($overrides, JSON_UNESCAPED_UNICODE));
    }

    private function overrides(): array
    {
        $raw = (string) Option::get('zsgp.oneboat', self::OPTION_NAME, '');
        if ($raw === '') {
            return [];
        }
        $decoded = json_decode($raw, true);
        if (!is_array($decoded)) {
            return [];
        }
        return array_intersect_key($decoded, self::FIELDS);
    }
}
'''


def read(p):
    return io.open(p, encoding="utf-8").read()

def write(p, s):
    io.open(p, "w", encoding="utf-8", newline="").write(s)

def patch(path, pairs):
    p = os.path.join(BASE, path)
    s = read(p)
    for old, new, count in pairs:
        n = s.count(old)
        assert n >= count, f"{path}: '{old[:60]}' found {n}, need {count}"
        s = s.replace(old, new, count)
    write(p, s)
    print("patched", path)


# 1. textservice.php
write(os.path.join(BASE, "lib/service/textservice.php"), TEXTSERVICE)
print("created lib/service/textservice.php")

# 2. include.php — autoload
patch("include.php", [
    ("'Zsgp\\\\OneBoat\\\\Service\\\\TeamService' => 'lib/service/teamservice.php',",
     "'Zsgp\\\\OneBoat\\\\Service\\\\TeamService' => 'lib/service/teamservice.php',\n    'Zsgp\\\\OneBoat\\\\Service\\\\TextService' => 'lib/service/textservice.php',", 1),
])

# 3. components: TEXTS в arResult
patch("install/components/zsgp/oneboat.landing/class.php", [
    ("use Zsgp\\OneBoat\\Service\\TeamService;",
     "use Zsgp\\OneBoat\\Service\\TeamService;\nuse Zsgp\\OneBoat\\Service\\TextService;", 1),
    ("'SETTINGS' => $settings,",
     "'SETTINGS' => $settings,\n            'TEXTS' => (new TextService())->get(),", 1),
])
patch("install/components/zsgp/oneboat.dashboard/class.php", [
    ("use Zsgp\\OneBoat\\Service\\TeamService;",
     "use Zsgp\\OneBoat\\Service\\TeamService;\nuse Zsgp\\OneBoat\\Service\\TextService;", 1),
    ("'SETTINGS' => $settings,",
     "'SETTINGS' => $settings,\n            'TEXTS' => (new TextService())->get(),", 1),
])

# 4. landing template
T = "$texts = $arResult['TEXTS'] ?? [];\n$T = static fn (string $key): string => htmlspecialchars((string) ($texts[$key] ?? ''));"
patch("install/components/zsgp/oneboat.landing/templates/.default/template.php", [
    ("$settings = $arResult['SETTINGS'];",
     "$settings = $arResult['SETTINGS'];\n" + T, 1),
    ('<p class="ob-kicker ob-stagger ob-stagger--1">Корпоративный командный конкурс</p>',
     '<p class="ob-kicker ob-stagger ob-stagger--1"><?=$T(\'LANDING_KICKER\')?></p>', 1),
    ('data-ob-open-join>Регистрация<', 'data-ob-open-join><?=$T(\'BTN_REGISTER\')?><', 2),
    ('>Перейти к моей команде</a>', '><?=$T(\'BTN_MY_TEAM\')?></a>', 1),
    ('data-ob-draw-continue hidden>Перейти к моей команде<', 'data-ob-draw-continue hidden><?=$T(\'BTN_MY_TEAM\')?><', 1),
    ('>Смотреть команды и рейтинг</a>', '><?=$T(\'BTN_TEAMS\')?></a>', 1),
    ('>Условия конкурса</a>', '><?=$T(\'BTN_RULES\')?></a>', 1),
    ('<strong><?=$teamCount?></strong> экипажей</span>', '<strong><?=$teamCount?></strong> <?=$T(\'CHIP_TEAMS_SUFFIX\')?></span>', 1),
    ('<i></i> общий курс</span>', '<i></i> <?=$T(\'CHIP_ROUTE\')?></span>', 1),
    ('<span class="ob-motion-hint">Двигайте курсором</span>', '<span class="ob-motion-hint"><?=$T(\'MOTION_HINT\')?></span>', 1),
    ('aria-label="Ключевые особенности конкурса"', 'aria-label="<?=$T(\'FACTS_ARIA\')?>"', 1),
    ('<strong><?=$teamCount?> команд</strong><small>равное распределение</small>',
     '<strong><?=$teamCount?> <?=$T(\'FACT1_SUFFIX\')?></strong><small><?=$T(\'FACT1_SUB\')?></small>', 1),
    ('<strong>1 общий маршрут</strong><small>от идеи к результату</small>',
     '<strong><?=$T(\'FACT2_TITLE\')?></strong><small><?=$T(\'FACT2_SUB\')?></small>', 1),
    ('<strong>1 голос в день</strong><small>после верного ответа</small>',
     '<strong><?=$T(\'FACT3_TITLE\')?></strong><small><?=$T(\'FACT3_SUB\')?></small>', 1),
    ('<p class="ob-kicker">Календарь конкурса</p><h2 id="ob-stages-title">Маршрут по этапам</h2>',
     '<p class="ob-kicker"><?=$T(\'STAGES_KICKER\')?></p><h2 id="ob-stages-title"><?=$T(\'STAGES_TITLE\')?></h2>', 1),
    ('<p class="ob-kicker">О конкурсе</p>', '<p class="ob-kicker"><?=$T(\'ABOUT_KICKER\')?></p>', 1),
    ('<h2 id="ob-about-title">Вместе прокладываем маршрут к лучшим идеям</h2>',
     '<h2 id="ob-about-title"><?=$T(\'ABOUT_TITLE\')?></h2>', 1),
    ('<p class="ob-kicker">Как всё устроено</p>', '<p class="ob-kicker"><?=$T(\'STEPS_KICKER\')?></p>', 1),
    ('<h2 id="ob-steps-title">Три шага в одном направлении</h2>', '<h2 id="ob-steps-title"><?=$T(\'STEPS_TITLE\')?></h2>', 1),
    ('<h3>Войти в команду</h3><p>Подтвердите участие — система равномерно распределит вас случайным образом.</p>',
     '<h3><?=$T(\'STEP1_TITLE\')?></h3><p><?=$T(\'STEP1_TEXT\')?></p>', 1),
    ('<h3>Подготовить проект</h3><p>Познакомьтесь с экипажем, объедините опыт и раскройте идею команды.</p>',
     '<h3><?=$T(\'STEP2_TITLE\')?></h3><p><?=$T(\'STEP2_TEXT\')?></p>', 1),
    ('<h3>Поддержать лучших</h3><p>Отвечайте на один вопрос в день и отдавайте голос выбранной команде.</p>',
     '<h3><?=$T(\'STEP3_TITLE\')?></h3><p><?=$T(\'STEP3_TEXT\')?></p>', 1),
    ('<p class="ob-kicker">Все на борт</p><h2 id="ob-final-title">Большой результат начинается с одного шага</h2><p>Ваша команда уже ждёт. Присоединяйтесь и помогите общему проекту набрать ход.</p>',
     '<p class="ob-kicker"><?=$T(\'FINAL_KICKER\')?></p><h2 id="ob-final-title"><?=$T(\'FINAL_TITLE\')?></h2><p><?=$T(\'FINAL_TEXT\')?></p>', 1),
    ('>Открыть команды</a>', '><?=$T(\'BTN_OPEN_TEAMS\')?></a>', 1),
    ('<p class="ob-kicker">Условия</p>', '<p class="ob-kicker"><?=$T(\'RULES_KICKER\')?></p>', 1),
    ('<h2 id="ob-rules-title">Правила на борту</h2>', '<h2 id="ob-rules-title"><?=$T(\'RULES_TITLE\')?></h2>', 1),
    ('<p class="ob-contact">Вопросы:', '<p class="ob-contact"><?=$T(\'CONTACT_PREFIX\')?>', 1),
    ('>ПОЛОЖЕНИЕ КОНКУРСА</a>', '><?=$T(\'BTN_REGULATION\')?></a>', 1),
    ('disabled title="Ссылка появится после загрузки скана">ПОЛОЖЕНИЕ КОНКУРСА<',
     'disabled title="<?=$T(\'REGULATION_HINT\')?>"><?=$T(\'BTN_REGULATION\')?><', 1),
    ('<p class="ob-kicker">Подтверждение</p>', '<p class="ob-kicker"><?=$T(\'JOIN_KICKER\')?></p>', 1),
    ('<h2 id="ob-join-title">Готовы зарегистрироваться?</h2>', '<h2 id="ob-join-title"><?=$T(\'JOIN_TITLE\')?></h2>', 1),
    ('<p>После подтверждения система назначит вас в одну из самых малочисленных команд с доступным местом.</p>',
     '<p><?=$T(\'JOIN_TEXT\')?></p>', 1),
    ('>Отмена</button>', '><?=$T(\'BTN_CANCEL\')?></button>', 1),
    ('data-ob-confirm-join>Зарегистрироваться<', 'data-ob-confirm-join><?=$T(\'BTN_CONFIRM_JOIN\')?><', 1),
    ('<p class="ob-kicker">Жеребьёвка</p>', '<p class="ob-kicker"><?=$T(\'DRAW_KICKER\')?></p>', 1),
    ('<h2 id="ob-draw-title">Определяем ваш экипаж</h2>', '<h2 id="ob-draw-title"><?=$T(\'DRAW_TITLE\')?></h2>', 1),
    ('<p class="ob-draw__lead">Распределение выполняется на сервере между самыми малочисленными командами. Анимация только показывает уже сохранённый результат.</p>',
     '<p class="ob-draw__lead"><?=$T(\'DRAW_TEXT\')?></p>', 1),
    ('<small>Ваша команда</small>', '<small><?=$T(\'DRAW_TEAM_LABEL\')?></small>', 1),
])

# 5. dashboard template
patch("install/components/zsgp/oneboat.dashboard/templates/.default/template.php", [
    ("$participantTeamId = (int) ($arResult['PARTICIPANT']['TEAM_ID'] ?? 0);",
     "$participantTeamId = (int) ($arResult['PARTICIPANT']['TEAM_ID'] ?? 0);\n" + T, 1),
    ('>← О конкурсе</a>', '><?=$T(\'DASH_BACK\')?></a>', 1),
    ('<p class="ob-kicker">Команды конкурса</p>', '<p class="ob-kicker"><?=$T(\'DASH_KICKER\')?></p>', 1),
    ('<h1>В одной лодке</h1>', '<h1><?=$T(\'DASH_TITLE\')?></h1>', 1),
    ('<p>Откройте карточку, познакомьтесь с проектом и поддержите команду в период голосования.</p>',
     '<p><?=$T(\'DASH_SUBTITLE\')?></p>', 1),
    ("? 'Предварительная команда' : 'Ваша команда'?>",
     "? $T('MY_TEAM_PROVISIONAL') : $T('MY_TEAM_LABEL')?>", 1),
    ('data-ob-open-registration>Регистрация<', 'data-ob-open-registration><?=$T(\'BTN_REGISTER\')?><', 1),
    ('<p class="ob-kicker">Наши экипажи</p><h2 id="ob-teams-title">Выберите команду</h2>',
     '<p class="ob-kicker"><?=$T(\'CREW_KICKER\')?></p><h2 id="ob-teams-title"><?=$T(\'CREW_TITLE\')?></h2>', 1),
    ("'Сегодня вы уже проголосовали'", "$T('VOTE_DONE')", 1),
    ("'Сегодняшняя попытка уже использована'", "$T('VOTE_USED')", 1),
    ("'Сегодня доступен один голос'", "$T('VOTE_AVAILABLE')", 1),
    ("'Голосование сейчас закрыто'", "$T('VOTE_CLOSED')", 1),
    ('>Вы в этой команде<?=$arResult[\'IS_PROVISIONAL\'] ? \' · предварительно\' : \'\'?>',
     '><?=$T(\'OWN_TEAM_BADGE\')?><?=$arResult[\'IS_PROVISIONAL\'] ? $T(\'OWN_TEAM_SUFFIX\') : \'\'?>', 1),
    ('alt="Эмблема команды «<?=htmlspecialchars($team[\'name\'])?>»"',
     'alt="<?=htmlspecialchars(sprintf((string) ($texts[\'EMBLEM_ALT\'] ?? \'Эмблема команды «%s»\'), (string) $team[\'name\']))?>"', 1),
    ('<p class="ob-team-card__number">Команда <?=str_pad', '<p class="ob-team-card__number"><?=$T(\'TEAM_PREFIX\')?> <?=str_pad', 1),
    ('data-ob-team-details>О команде<', 'data-ob-team-details><?=$T(\'BTN_TEAM_DETAILS\')?><', 1),
    ('title="За свою команду голосовать нельзя"', 'title="<?=$T(\'SELF_VOTE_HINT\')?>"', 1),
    ("? 'Своя команда' : 'Голосовать'?", "? $T('BTN_OWN_TEAM') : $T('BTN_VOTE')?", 1),
    ('<p class="ob-kicker">Общий результат</p><h2 id="ob-rating-title">Рейтинг команд</h2>',
     '<p class="ob-kicker"><?=$T(\'RATING_KICKER\')?></p><h2 id="ob-rating-title"><?=$T(\'RATING_TITLE\')?></h2>', 1),
    ('<p>Обновляется автоматически раз в минуту</p>', '<p><?=$T(\'RATING_NOTE\')?></p>', 1),
    ('>ПОЛОЖЕНИЕ КОНКУРСА</a>', '><?=$T(\'BTN_REGULATION\')?></a>', 1),
    ('<p class="ob-kicker">Регистрация</p>', '<p class="ob-kicker"><?=$T(\'REG_KICKER\')?></p>', 1),
    ('<h2 id="ob-registration-title">Войти в команду?</h2>', '<h2 id="ob-registration-title"><?=$T(\'REG_TITLE\')?></h2>', 1),
    ('<p>После подтверждения система автоматически назначит вас в команду, где есть свободное место.</p>',
     '<p><?=$T(\'REG_TEXT\')?></p>', 1),
    ('>Отмена</button>', '><?=$T(\'BTN_CANCEL\')?></button>', 1),
    ('data-ob-confirm-registration>Зарегистрироваться<', 'data-ob-confirm-registration><?=$T(\'BTN_CONFIRM_JOIN\')?><', 1),
])

print("ALL OK")
