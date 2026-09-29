# -*- coding: utf-8 -*-
"""Перегруппировка текстов по страницам и местам + улучшенная админ-форма."""
import io, os

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
 *
 * Структура поля: [страница, секция, подпись, дефолт, многострочное].
 */
final class TextService
{
    public const OPTION_NAME = 'page_texts';

    private const FIELDS = [
        // ============ ЛЕНДИНГ ============
        'LANDING_KICKER' => ['landing', 'Шапка (корабль)', 'Плашка над заголовком', 'Корпоративный командный конкурс'],
        'CHIP_TEAMS_SUFFIX' => ['landing', 'Шапка (корабль)', 'Число команд: слово после цифры', 'экипажей'],
        'CHIP_ROUTE' => ['landing', 'Шапка (корабль)', 'Плашка на маршруте', 'общий курс'],
        'MOTION_HINT' => ['landing', 'Шапка (корабль)', 'Подсказка под кораблём', 'Двигайте курсором'],

        'FACTS_ARIA' => ['landing', 'Факты под кораблём', 'Название блока (для читалок)', 'Ключевые особенности конкурса'],
        'FACT1_SUFFIX' => ['landing', 'Факты под кораблём', 'Карточка 1: слово после числа команд', 'команд'],
        'FACT1_SUB' => ['landing', 'Факты под кораблём', 'Карточка 1: подпись', 'равное распределение'],
        'FACT2_TITLE' => ['landing', 'Факты под кораблём', 'Карточка 2: заголовок', '1 общий маршрут'],
        'FACT2_SUB' => ['landing', 'Факты под кораблём', 'Карточка 2: подпись', 'от идеи к результату'],
        'FACT3_TITLE' => ['landing', 'Факты под кораблём', 'Карточка 3: заголовок', '1 голос в день'],
        'FACT3_SUB' => ['landing', 'Факты под кораблём', 'Карточка 3: подпись', 'после верного ответа'],

        'STAGES_KICKER' => ['landing', 'Календарь этапов', 'Плашка', 'Календарь конкурса'],
        'STAGES_TITLE' => ['landing', 'Календарь этапов', 'Заголовок', 'Маршрут по этапам'],

        'ABOUT_KICKER' => ['landing', 'О конкурсе', 'Плашка', 'О конкурсе'],
        'ABOUT_TITLE' => ['landing', 'О конкурсе', 'Заголовок', 'Вместе прокладываем маршрут к лучшим идеям'],

        'STEPS_KICKER' => ['landing', 'Три шага', 'Плашка', 'Как всё устроено'],
        'STEPS_TITLE' => ['landing', 'Три шага', 'Заголовок', 'Три шага в одном направлении'],
        'STEP1_TITLE' => ['landing', 'Три шага', 'Шаг 01: заголовок', 'Войти в команду'],
        'STEP1_TEXT' => ['landing', 'Три шага', 'Шаг 01: текст', 'Подтвердите участие — система равномерно распределит вас случайным образом.', true],
        'STEP2_TITLE' => ['landing', 'Три шага', 'Шаг 02: заголовок', 'Подготовить проект'],
        'STEP2_TEXT' => ['landing', 'Три шага', 'Шаг 02: текст', 'Познакомьтесь с экипажем, объедините опыт и раскройте идею команды.', true],
        'STEP3_TITLE' => ['landing', 'Три шага', 'Шаг 03: заголовок', 'Поддержать лучших'],
        'STEP3_TEXT' => ['landing', 'Три шага', 'Шаг 03: текст', 'Отвечайте на один вопрос в день и отдавайте голос выбранной команде.', true],

        'FINAL_KICKER' => ['landing', 'Финальный призыв', 'Плашка', 'Все на борт'],
        'FINAL_TITLE' => ['landing', 'Финальный призыв', 'Заголовок', 'Большой результат начинается с одного шага'],
        'FINAL_TEXT' => ['landing', 'Финальный призыв', 'Текст', 'Ваша команда уже ждёт. Присоединяйтесь и помогите общему проекту набрать ход.', true],

        'RULES_KICKER' => ['landing', 'Правила и контакты', 'Плашка', 'Условия'],
        'RULES_TITLE' => ['landing', 'Правила и контакты', 'Заголовок', 'Правила на борту'],
        'CONTACT_PREFIX' => ['landing', 'Правила и контакты', 'Подпись перед контактом', 'Вопросы:'],
        'REGULATION_HINT' => ['landing', 'Правила и контакты', 'Подсказка у неактивной кнопки положения', 'Ссылка появится после загрузки скана'],

        'JOIN_KICKER' => ['landing', 'Диалог «Зарегистрироваться»', 'Плашка', 'Подтверждение'],
        'JOIN_TITLE' => ['landing', 'Диалог «Зарегистрироваться»', 'Заголовок', 'Готовы зарегистрироваться?'],
        'JOIN_TEXT' => ['landing', 'Диалог «Зарегистрироваться»', 'Текст', 'После подтверждения система назначит вас в одну из самых малочисленных команд с доступным местом.', true],

        'DRAW_KICKER' => ['landing', 'Диалог жеребьёвки', 'Плашка', 'Жеребьёвка'],
        'DRAW_TITLE' => ['landing', 'Диалог жеребьёвки', 'Заголовок', 'Определяем ваш экипаж'],
        'DRAW_TEXT' => ['landing', 'Диалог жеребьёвки', 'Текст', 'Распределение выполняется на сервере между самыми малочисленными командами. Анимация только показывает уже сохранённый результат.', true],
        'DRAW_TEAM_LABEL' => ['landing', 'Диалог жеребьёвки', 'Подпись над названием команды', 'Ваша команда'],

        // ============ СТРАНИЦА КОМАНД ============
        'DASH_BACK' => ['dashboard', 'Шапка', 'Ссылка назад на лендинг', '← О конкурсе'],
        'DASH_KICKER' => ['dashboard', 'Шапка', 'Плашка', 'Команды конкурса'],
        'DASH_TITLE' => ['dashboard', 'Шапка', 'Заголовок', 'В одной лодке'],
        'DASH_SUBTITLE' => ['dashboard', 'Шапка', 'Подзаголовок', 'Откройте карточку, познакомьтесь с проектом и поддержите команду в период голосования.', true],
        'MY_TEAM_LABEL' => ['dashboard', 'Шапка', 'Плашка «Ваша команда»', 'Ваша команда'],
        'MY_TEAM_PROVISIONAL' => ['dashboard', 'Шапка', 'Плашка «Предварительная команда»', 'Предварительная команда'],

        'CREW_KICKER' => ['dashboard', 'Список команд', 'Плашка', 'Наши экипажи'],
        'CREW_TITLE' => ['dashboard', 'Список команд', 'Заголовок', 'Выберите команду'],
        'VOTE_DONE' => ['dashboard', 'Список команд', 'Статус: уже голосовали', 'Сегодня вы уже проголосовали'],
        'VOTE_USED' => ['dashboard', 'Список команд', 'Статус: попытка использована', 'Сегодняшняя попытка уже использована'],
        'VOTE_AVAILABLE' => ['dashboard', 'Список команд', 'Статус: голос доступен', 'Сегодня доступен один голос'],
        'VOTE_CLOSED' => ['dashboard', 'Список команд', 'Статус: голосование закрыто', 'Голосование сейчас закрыто'],

        'TEAM_PREFIX' => ['dashboard', 'Карточка команды', 'Слово перед номером', 'Команда'],
        'OWN_TEAM_BADGE' => ['dashboard', 'Карточка команды', 'Метка на своей команде', 'Вы в этой команде'],
        'OWN_TEAM_SUFFIX' => ['dashboard', 'Карточка команды', 'Приписка «предварительно»', ' · предварительно'],
        'EMBLEM_ALT' => ['dashboard', 'Карточка команды', 'Alt эмблемы (%s — название)', 'Эмблема команды «%s»'],
        'SELF_VOTE_HINT' => ['dashboard', 'Карточка команды', 'Подсказка «за свою нельзя»', 'За свою команду голосовать нельзя'],

        'RATING_KICKER' => ['dashboard', 'Рейтинг', 'Плашка', 'Общий результат'],
        'RATING_TITLE' => ['dashboard', 'Рейтинг', 'Заголовок', 'Рейтинг команд'],
        'RATING_NOTE' => ['dashboard', 'Рейтинг', 'Примечание', 'Обновляется автоматически раз в минуту'],

        'REG_KICKER' => ['dashboard', 'Диалог «Войти в команду»', 'Плашка', 'Регистрация'],
        'REG_TITLE' => ['dashboard', 'Диалог «Войти в команду»', 'Заголовок', 'Войти в команду?'],
        'REG_TEXT' => ['dashboard', 'Диалог «Войти в команду»', 'Текст', 'После подтверждения система автоматически назначит вас в команду, где есть свободное место.', true],

        // ============ ОБЩИЕ КНОПКИ ============
        'BTN_REGISTER' => ['shared', 'Кнопки', '«Регистрация»', 'Регистрация'],
        'BTN_CONFIRM_JOIN' => ['shared', 'Кнопки', '«Зарегистрироваться» (в диалогах)', 'Зарегистрироваться'],
        'BTN_CANCEL' => ['shared', 'Кнопки', '«Отмена»', 'Отмена'],
        'BTN_MY_TEAM' => ['shared', 'Кнопки', '«Перейти к моей команде»', 'Перейти к моей команде'],
        'BTN_TEAMS' => ['shared', 'Кнопки', '«Смотреть команды и рейтинг»', 'Смотреть команды и рейтинг'],
        'BTN_OPEN_TEAMS' => ['shared', 'Кнопки', '«Открыть команды»', 'Открыть команды'],
        'BTN_RULES' => ['shared', 'Кнопки', '«Условия конкурса»', 'Условия конкурса'],
        'BTN_REGULATION' => ['shared', 'Кнопки', '«ПОЛОЖЕНИЕ КОНКУРСА»', 'ПОЛОЖЕНИЕ КОНКУРСА'],
        'BTN_VOTE' => ['shared', 'Кнопки', '«Голосовать»', 'Голосовать'],
        'BTN_OWN_TEAM' => ['shared', 'Кнопки', 'На своей команде', 'Своя команда'],
        'BTN_TEAM_DETAILS' => ['shared', 'Кнопки', '«О команде»', 'О команде'],
    ];

    private const PAGE_LABELS = [
        'landing' => 'Лендинг · /one-boat/',
        'dashboard' => 'Страница команд · /one-boat/teams/',
        'shared' => 'Общие кнопки (обе страницы)',
    ];

    /** Все тексты: дефолты + переопределения из опций. */
    public function get(): array
    {
        $overrides = $this->overrides();
        $texts = [];
        foreach (self::FIELDS as $key => $meta) {
            $texts[$key] = $overrides[$key] ?? $meta[3];
        }
        return $texts;
    }

    /**
     * Для админской формы: сгруппировано по странице и секции.
     * [page_label => [section => [key => meta]]]
     */
    public function describe(): array
    {
        $overrides = $this->overrides();
        $result = [];
        foreach (self::FIELDS as $key => $meta) {
            [$page, $section, $label, $default, $multiline] = $meta;
            $pageLabel = self::PAGE_LABELS[$page] ?? $page;
            $result[$pageLabel][$section][$key] = [
                'label' => $label,
                'default' => $default,
                'multiline' => !empty($multiline),
                'value' => $overrides[$key] ?? $default,
                'overridden' => isset($overrides[$key]),
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
            if ($value !== '' && $value !== $meta[3]) {
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


write(os.path.join(BASE, "lib/service/textservice.php"), TEXTSERVICE)
print("textservice.php rewritten")

# --- settings.php: новая форма ---
p = os.path.join(BASE, "admin/settings.php")
s = read(p)

# describe() теперь возвращает вложенную структуру — старый блок формы заменяем
old_start = '<div class="zsgp-ob-admin-card">\n    <h3>Тексты страниц</h3>'
idx = s.find(old_start)
assert idx >= 0, "old texts card not found"
end_marker = '<div class="zsgp-ob-admin-actions">'
end_idx = s.find(end_marker, idx)
assert end_idx > idx
new_block = '''<h3 style="margin:18px 0 4px">Тексты страниц</h3>
<p class="zsgp-ob-muted" style="margin:0 0 12px">Каждый блок — место на странице. Очистите поле, чтобы вернуть стандартный текст (он показан под полем у изменённых).</p>
<div class="zsgp-ob-admin-grid">
<?php foreach ($textFields as $pageLabel => $sections): ?>
    <?php foreach ($sections as $sectionLabel => $fields): ?>
    <div class="zsgp-ob-admin-card">
        <h4 style="margin:0 0 2px"><?=htmlspecialcharsbx($pageLabel)?></h4>
        <p class="zsgp-ob-muted" style="margin:0 0 10px"><?=htmlspecialcharsbx($sectionLabel)?></p>
        <?php foreach ($fields as $textKey => $textMeta): ?>
            <label for="ob-text-<?=htmlspecialcharsbx($textKey)?>"><?=htmlspecialcharsbx($textMeta['label'])?></label>
            <?php if ($textMeta['multiline']): ?>
                <textarea id="ob-text-<?=htmlspecialcharsbx($textKey)?>" name="TEXTS[<?=htmlspecialcharsbx($textKey)?>]" rows="3"><?=htmlspecialcharsbx($textMeta['value'])?></textarea>
            <?php else: ?>
                <input id="ob-text-<?=htmlspecialcharsbx($textKey)?>" type="text" name="TEXTS[<?=htmlspecialcharsbx($textKey)?>]" maxlength="500" value="<?=htmlspecialcharsbx($textMeta['value'])?>">
            <?php endif; ?>
            <?php if ($textMeta['overridden']): ?>
                <p class="zsgp-ob-muted" style="margin:2px 0 8px;font-size:12px">Стандартно: <?=htmlspecialcharsbx($textMeta['default'])?></p>
            <?php endif; ?>
        <?php endforeach; ?>
    </div>
    <?php endforeach; ?>
<?php endforeach; ?>
</div>
'''
s = s[:idx] + new_block + s[end_idx:]
write(p, s)
print("settings.php form updated")
print("ALL OK")
