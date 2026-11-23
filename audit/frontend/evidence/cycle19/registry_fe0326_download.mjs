import fs from 'node:fs';
const f = './audit/frontend/ISSUES.json';
const d = JSON.parse(fs.readFileSync(f, 'utf8'));
const i = d.issues.find((x) => x.id === 'FE-0326');

i.impact =
  'Нет текущего пользовательского воздействия: FE-0326 — false positive. Валидные PNG дают корректные private/public preview; публичное скачивание отдаёт сохранённое представление (WebP для оптимизированных small/large, исходный PNG для medium). Историческое утверждение о битом превью относилось к невалидной тестовой фикстуре и сохранено в истории.';
i.statusRationale =
  i.statusRationale + ' Download follow-up: the legacy private GET /my-files/{id}/download is 410 by design; the current contract is POST /download-grant + GET /download-grant/{token}. Public download returns the stored representation (WebP for optimized media, original PNG when no optimization), so matchesOriginal=false for optimized images is expected. The matrix test used the legacy endpoint and compared to the original SHA; that was a methodology error, not an app defect.';
i.currentConclusion =
  'Rejected / false positive: the corrupt preview came from an invalid 180-byte test PNG, not from the app. Valid PNGs of different sizes produce valid private/public previews and downloads. Download contract: legacy private GET is 410 by design; private grant and public download serve the stored representation (WebP when optimized), so original-SHA comparison is invalid for optimized media. The test fixture and download methodology are fixed; no remediation task for the app is required.';
i.evidence[4] =
  '[cycle19:matrix] Valid PNGs small 32x32 (117 B, SHA aac8...), medium 512x512 (4,485 B, SHA f440...), large 1600x1200 (5,769,402 B, SHA 9561...) uploaded via UI. Preview worker ready; private/public preview: small image/webp 80 B, medium image/png 4,485 B with SHA equal to the original, large image/webp 1,437,182 B. Browser img.complete true, natural sizes 32/512/1600, no visual error. Public download: small 80 B WebP (matches preview), medium 4,485 B PNG (matches original), large 1,437,182 B WebP (matches preview); storage_mode optimized_media for small/large, stored for medium. No corruption.';
i.evidence.push(
  '[cycle19:download-contract] Legacy private GET /my-files/{id}/download returns 410 by design (comment: legacy blob/XHR path disabled). Current private download: POST /my-files/{id}/download-grant -> GET /my-files/download-grant/{token}; public: GET /my-files/public/{token}/download. Both return the stored representation. For optimized images the DB has storage_mode=optimized_media, download_file_name=*.webp, download_mime_type=image/webp; comparing to original SHA is invalid. The matrix used the legacy endpoint and original SHA, hence 410/matchesOriginal=false. Test methodology corrected; no new defect.',
);
i.downloadContract = {
  privateLegacy: 'GET /api/v1/my-files/{id}/download -> 410 by design',
  privateCurrent: 'POST /api/v1/my-files/{id}/download-grant -> GET /api/v1/my-files/download-grant/{token}',
  public: 'GET /api/v1/my-files/public/{token}/download',
  representation: 'stored payload; WebP for optimized_media, original when stored',
  matrixNote: 'small/large public downloads are WebP and match the preview; medium is the original PNG; legacy private 410 is expected',
};
const note = i.reverificationHistory.find((h) => h.cycle === 19 && h.verdict === 'rejected');
if (note) {
  note.note =
    'Matrix with valid small/medium/large PNGs: previews valid, browser/Pillow decode. Downloads: public serves stored representation (WebP for optimized small/large, original PNG for medium); legacy private GET is 410 by design, grant flow is current. Cycle18 artifact traced to an invalid 180-byte test fixture (IDAT CRC mismatch); fixture fixed; MyFiles E2E 11 mandatory + 1 observation, 0 failed. Download methodology corrected; FE-0326 stays Rejected.';
}
fs.writeFileSync(f, JSON.stringify(d, null, 2) + '\n', 'utf8');
console.log('FE-0326 download contract updated');
