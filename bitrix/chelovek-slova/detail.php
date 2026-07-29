<?php
require($_SERVER["DOCUMENT_ROOT"] . "/bitrix/modules/main/include/prolog_before.php");

global $APPLICATION, $USER;

$APPLICATION->SetTitle("");

// --- ВАШИ ID ---
$iblock_id = 21;   // ID Инфоблока "Сотрудники"

require($_SERVER["DOCUMENT_ROOT"] . "/bitrix/header.php");

$APPLICATION->SetAdditionalCSS(dirname($_SERVER["PHP_SELF"]) . "/style.css");
$APPLICATION->AddHeadScript(dirname($_SERVER["PHP_SELF"]) . "/../animations.js");

if (!CModule::IncludeModule("iblock")) {
    echo "Ошибка подключения модуля инфоблоков.";
    require($_SERVER["DOCUMENT_ROOT"] . "/bitrix/footer.php");
    die();
}

$element_id = isset($_GET["id"]) ? (int)$_GET["id"] : 0;

if (!$element_id) {
    echo "Сотрудник не найден.";
    require($_SERVER["DOCUMENT_ROOT"] . "/bitrix/footer.php");
    die();
}

$rs = CIBlockElement::GetList(
    [],
    [
        "IBLOCK_ID" => $iblock_id,
        "ID" => $element_id,
        "ACTIVE" => "Y"
    ],
    false,
    false,
    [
        "ID",
        "IBLOCK_ID",
        "NAME",
        "PREVIEW_PICTURE",
        "DETAIL_PICTURE",
        "DETAIL_TEXT"
    ]
);

if ($ob = $rs->GetNextElement()) {
    $fields = $ob->GetFields();
    $props = $ob->GetProperties();

    $videoUrl = !empty($props["LINK"]["VALUE"]) ? trim($props["LINK"]["VALUE"]) : "";
    $position = !empty($props["POSITION"]["VALUE"]) ? $props["POSITION"]["VALUE"] : "";
    $city = !empty($props["CITY"]["VALUE"]) ? $props["CITY"]["VALUE"] : "";

    $photoID = !empty($fields["DETAIL_PICTURE"])
        ? $fields["DETAIL_PICTURE"]
        : $fields["PREVIEW_PICTURE"];

    $img = $photoID
        ? CFile::GetPath($photoID)
        : "/bitrix/images/main/no_photo.png";

    $fio = explode(" ", trim($fields["NAME"]));
    $surname = isset($fio[0]) ? $fio[0] : "";
    $name_other = count($fio) > 1
        ? implode(" ", array_slice($fio, 1))
        : $fields["NAME"];

    $APPLICATION->SetTitle($fields["NAME"]);
    ?>

    <div class="voting-section-wrapper">

        <a href="index.php" style="color: #999; border-bottom: 1px dashed #999; display: inline-block; margin-bottom: 20px;">
            ← Назад к списку
        </a>

        <div class="detail-wrapper">

            <div class="detail-left">

                <div class="detail-photo-container">
                    <span class="finalist-badge finalist-badge--detail">Финалист</span>
                    <img
                        alt="<?= htmlspecialcharsbx($fields["NAME"]) ?>"
                        src="<?= htmlspecialcharsbx($img) ?>"
                        class="detail-photo"
                    >

                    <?php if ($videoUrl): ?>
                        <div class="play-btn-overlay" onclick="openVideo('<?= CUtil::JSEscape($videoUrl) ?>')">
                            <div class="play-arrow"></div>
                        </div>
                    <?php endif; ?>
                </div>

            </div>

            <div class="detail-right">

                <h1 class="detail-name">
                    <?= htmlspecialcharsbx($surname) ?>
                </h1>

                <div class="detail-subname">
                    <?= htmlspecialcharsbx($name_other) ?>
                </div>

                <div class="detail-meta">
                    <?php if ($position): ?>
                        <strong><?= htmlspecialcharsbx($position) ?></strong><br>
                    <?php endif; ?>

                    <?php if ($city): ?>
                        <?= htmlspecialcharsbx($city) ?>
                    <?php endif; ?>
                </div>

                <div class="detail-text">
                    <?= $fields["~DETAIL_TEXT"] ?>
                </div>

            </div>

        </div>

    </div>

    <div id="videoModal" class="video-modal" onclick="closeVideo()">
        <div class="video-content" onclick="event.stopPropagation()">
            <span class="close-video" onclick="closeVideo()">×</span>
            <iframe
                id="videoFrame"
                width="100%"
                height="100%"
                src=""
                frameborder="0"
                allow="autoplay; encrypted-media"
                allowfullscreen
            ></iframe>
        </div>
    </div>

    <script>
        function openVideo(url) {
            var embedUrl = url;

            if (url.indexOf("rutube.ru") !== -1) {
                var rutubeMatch = url.match(/video\/([a-zA-Z0-9]+)/);

                if (rutubeMatch && rutubeMatch[1]) {
                    embedUrl = "https://rutube.ru/play/embed/" + rutubeMatch[1];
                }
            } else if (url.indexOf("youtu") !== -1) {
                var videoId = "";

                if (url.indexOf("v=") !== -1) {
                    videoId = url.split("v=")[1].split("&")[0];
                } else if (url.indexOf("be/") !== -1) {
                    videoId = url.split("be/")[1].split("?")[0];
                }

                if (videoId) {
                    embedUrl = "https://www.youtube.com/embed/" + videoId + "?autoplay=1";
                }
            }

            document.getElementById("videoFrame").src = embedUrl;
            openModal("videoModal");
        }

        function closeVideo() {
            closeModal("videoModal");
            document.getElementById("videoFrame").src = "";
        }
    </script>

    <?php
} else {
    echo "Сотрудник не найден.";
}

require($_SERVER["DOCUMENT_ROOT"] . "/bitrix/footer.php");
?>
