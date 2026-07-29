<?php
require($_SERVER["DOCUMENT_ROOT"] . "/bitrix/modules/main/include/prolog_before.php");

global $APPLICATION, $USER;

// --- НАСТРОЙКИ ---
$iblock_id = 21;

require($_SERVER["DOCUMENT_ROOT"] . "/bitrix/header.php");

$APPLICATION->SetTitle("Участники конкурса");
$APPLICATION->SetAdditionalCSS(dirname($_SERVER["PHP_SELF"]) . "/style.css");
$APPLICATION->AddHeadScript(dirname($_SERVER["PHP_SELF"]) . "/../animations.js");
?>

<div class="voting-section-wrapper">
    <h2 class="finalists-section-title">Финалисты конкурса «Человек Слова»</h2>

    <div class="finalists-intro">
        <p>
            Определены 13 участников, которые продолжат борьбу за почетное звание «Человек Слова&nbsp;—&nbsp;2026».
        </p>
        <p>
            При подведении итогов учитывались не только результаты народного голосования,
            но и другие важные критерии:
        </p>
        <ul class="finalists-criteria">
            <li>сложность и актуальность поставленной задачи;</li>
            <li>качество и полнота выполнения конкурсного задания;</li>
            <li>количество голосов, полученных в ходе народного голосования.</li>
        </ul>
        <p>
            По итогам оценки сформирован список участников, которые продолжают борьбу за звание «Человек Слова&nbsp;—&nbsp;2026».
        </p>
    </div>

    <div class="voting-grid">
        <?php
        $iblockIncluded = CModule::IncludeModule("iblock");

        if ($iblockIncluded) {
            $arSelect = ["ID", "NAME", "PREVIEW_PICTURE", "PROPERTY_POSITION", "PROPERTY_CITY", "PROPERTY_NOT_PASSED_STAGE"];

            $arFilter = [
                "IBLOCK_ID" => $iblock_id,
                "ACTIVE_DATE" => "Y",
                "ACTIVE" => "Y",
                "!PROPERTY_NOT_PASSED_STAGE" => "N"
            ];

            $res = CIBlockElement::GetList(["SORT" => "ASC"], $arFilter, false, false, $arSelect);

            while ($ob = $res->GetNextElement()) {
                $arFields = $ob->GetFields();

                $img = $arFields["PREVIEW_PICTURE"]
                    ? CFile::GetPath($arFields["PREVIEW_PICTURE"])
                    : "/bitrix/images/main/no_photo.png";

                $detailLink = "detail.php?id=" . (int)$arFields["ID"];

                $fio = explode(' ', $arFields["NAME"]);
                $surname = isset($fio[0]) ? $fio[0] : $arFields["NAME"];
                $nameOther = count($fio) > 1 ? implode(' ', array_slice($fio, 1)) : "";

                $position = isset($arFields["PROPERTY_POSITION_VALUE"]) ? $arFields["PROPERTY_POSITION_VALUE"] : "";
                $city = isset($arFields["PROPERTY_CITY_VALUE"]) ? $arFields["PROPERTY_CITY_VALUE"] : "";

                $infoText = htmlspecialcharsbx($position);
                if (!empty($city)) {
                    $infoText .= "<br>" . htmlspecialcharsbx($city);
                }
                ?>
                <div class="vote-card vote-card--finalist">
                    <a href="<?= htmlspecialcharsbx($detailLink) ?>" class="vote-card-img-link">
                        <span class="finalist-badge">Финалист</span>
                        <img
                            src="<?= htmlspecialcharsbx($img) ?>"
                            alt="<?= htmlspecialcharsbx($arFields["NAME"]) ?>"
                            class="vote-card-img"
                        >
                    </a>

                    <div class="vote-card-footer">
                        <div class="footer-default">
                            <div class="vote-info-block">
                                <span class="vote-surname"><?= htmlspecialcharsbx($surname) ?></span>
                                <span class="vote-name"><?= htmlspecialcharsbx($nameOther) ?></span>
                                <span class="vote-job"><?= $infoText ?></span>
                            </div>
                        </div>
                    </div>
                </div>
                <?php
            }
        }
        ?>
    </div>
</div>

<?php require($_SERVER["DOCUMENT_ROOT"] . "/bitrix/footer.php"); ?>
