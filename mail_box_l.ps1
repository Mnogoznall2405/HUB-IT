<#
.Synopsis
    Экспорт списка почтовых ящиков Exchange 2019 через удаленную PSSession
.Description
    Скрипт подключается к Exchange, получает данные о ящиках, конвертирует размеры без использования методов .ToMB()
#>

Clear-Host
Write-Host "========================================" -ForegroundColor Cyan
Write-Host "  СБОР ИНФОРМАЦИИ О ПОЧТОВЫХ ЯЩИКАХ EXCHANGE" -ForegroundColor Cyan
Write-Host "========================================" -ForegroundColor Cyan
Write-Host ""

# 1. ЗАПРАШИВАЕМ УЧЕТНЫЕ ДАННЫЕ
Write-Host "Введите учетные данные для подключения к Exchange серверу:" -ForegroundColor Yellow
$UserCredentials = Get-Credential -Message "Введите учетные данные администратора Exchange"

if ($UserCredentials -eq $null) {
    Write-Host "Операция отменена пользователем." -ForegroundColor Red
    break
}

# 2. ЗАПРАШИВАЕМ АДРЕС EXCHANGE СЕРВЕРА
Write-Host ""
$ExchangeServer = Read-Host "Введите имя Exchange сервера (например: EXCH01 или mail.company.ru)"

if ([string]::IsNullOrWhiteSpace($ExchangeServer)) {
    Write-Host "Адрес сервера не указан." -ForegroundColor Red
    break
}

# 3. ПОДКЛЮЧЕНИЕ ЧЕРЕЗ PSSESSION
Write-Host ""
Write-Host "Подключение к Exchange серверу $ExchangeServer..." -ForegroundColor Yellow
Write-Host "Используется: http://$ExchangeServer/PowerShell/" -ForegroundColor Gray

try {
    $Session = New-PSSession -ConfigurationName Microsoft.Exchange `
                             -ConnectionUri "http://$ExchangeServer/PowerShell/" `
                             -Authentication Kerberos `
                             -Credential $UserCredentials `
                             -ErrorAction Stop
    
    Import-PSSession $Session -DisableNameChecking -AllowClobber -ErrorAction Stop | Out-Null
    
    Write-Host "УСПЕШНОЕ ПОДКЛЮЧЕНИЕ!" -ForegroundColor Green
}
catch {
    Write-Host ""
    Write-Host "ОШИБКА ПОДКЛЮЧЕНИЯ:" -ForegroundColor Red
    Write-Host $_.Exception.Message -ForegroundColor Red
    Write-Host ""
    Write-Host "Нажмите любую клавишу для выхода..."
    $null = $Host.UI.RawUI.ReadKey("NoEcho,IncludeKeyDown")
    break
}

# 4. СОЗДАЕМ ПАПКУ ДЛЯ ОТЧЕТОВ
$LocalFolder = "C:\Temp\MailData"
if (!(Test-Path $LocalFolder)) {
    Write-Host ""
    Write-Host "Создание папки $LocalFolder..." -ForegroundColor Yellow
    New-Item -ItemType Directory -Path $LocalFolder -Force | Out-Null
    Write-Host "Папка создана." -ForegroundColor Green
}

$LocalOutputPath = Join-Path $LocalFolder "MailboxQuotaReport_$(Get-Date -Format 'yyyyMMdd_HHmmss').csv"
$LocalSummaryPath = Join-Path $LocalFolder "MailboxQuotaSummary_$(Get-Date -Format 'yyyyMMdd_HHmmss').txt"

Write-Host ""
Write-Host "СБОР ИНФОРМАЦИИ О ПОЧТОВЫХ ЯЩИКАХ" -ForegroundColor Yellow
Write-Host "Всего ящиков: 1122" -ForegroundColor Cyan
Write-Host "Это займет около 5-10 минут..." -ForegroundColor Gray
Write-Host ""

# 5. ПОЛУЧАЕМ ДАННЫЕ С СЕРВЕРА (без использования .ToMB() и .ToGB())
try {
    Write-Host "Получение списка почтовых ящиков..." -ForegroundColor Cyan
    $Mailboxes = Get-Mailbox -ResultSize Unlimited -RecipientTypeDetails UserMailbox, SharedMailbox -ErrorAction Stop
    
    $TotalCount = $Mailboxes.Count
    Write-Host "Найдено почтовых ящиков: $TotalCount" -ForegroundColor Green
    Write-Host ""
    
    $Results = @()
    $Current = 0
    $ErrorCount = 0
    
    foreach ($Mb in $Mailboxes) {
        $Current++
        
        # Прогресс-бар
        $PercentComplete = [math]::Round(($Current / $TotalCount) * 100, 0)
        Write-Progress -Activity "Обработка почтовых ящиков" `
                       -Status "Обработано: $Current из $TotalCount ($PercentComplete%) - $($Mb.DisplayName)" `
                       -PercentComplete $PercentComplete
        
        # Получаем статистику (размер ящика)
        try {
            $Stats = Get-MailboxStatistics -Identity $Mb.Identity -ErrorAction SilentlyContinue
        }
        catch {
            $Stats = $null
            $ErrorCount++
        }
        
        # ===== ВАЖНО: Конвертация размера БЕЗ использования .ToMB() =====
        # В десериализованных объектах размер хранится как строка, например "12.34 GB (12,345,678,912 bytes)"
        
        $UsedSizeMB = $null
        $UsedSizeGB = $null
        
        if ($Stats -and $Stats.TotalItemSize) {
            # Получаем строку с размером
            $SizeString = $Stats.TotalItemSize.ToString()
            
            # Извлекаем число в гигабайтах из строки (пример: "12.34 GB")
            if ($SizeString -match "([\d\.]+)\s*GB") {
                $UsedSizeGB = [math]::Round([double]$Matches[1], 2)
                $UsedSizeMB = [math]::Round($UsedSizeGB * 1024, 2)
            }
            # Если в мегабайтах
            elseif ($SizeString -match "([\d\.]+)\s*MB") {
                $UsedSizeMB = [math]::Round([double]$Matches[1], 2)
                $UsedSizeGB = [math]::Round($UsedSizeMB / 1024, 2)
            }
            # Если в байтах
            elseif ($SizeString -match "([\d\.]+)\s*bytes") {
                $bytes = [double]$Matches[1]
                $UsedSizeGB = [math]::Round($bytes / 1GB, 2)
                $UsedSizeMB = [math]::Round($bytes / 1MB, 2)
            }
            else {
                # Пробуем другой подход
                try {
                    $bytesValue = $Stats.TotalItemSize.Value
                    if ($bytesValue -is [long] -or $bytesValue -is [int]) {
                        $UsedSizeGB = [math]::Round($bytesValue / 1GB, 2)
                        $UsedSizeMB = [math]::Round($bytesValue / 1MB, 2)
                    }
                }
                catch {
                    $UsedSizeMB = $null
                    $UsedSizeGB = $null
                }
            }
        }
        
        # Квота и свободное место (аналогично - без .ToMB())
        $QuotaLimitMB = "Безлимит"
        $QuotaLimitGB = "Безлимит"
        $FreeSpaceMB = "Безлимит"
        $FreeSpaceGB = "Безлимит"
        $PercentUsed = "N/A"
        
        if ($Mb.ProhibitSendReceiveQuota -ne $null -and !$Mb.ProhibitSendReceiveQuota.IsUnlimited) {
            # Извлекаем квоту из строки
            $QuotaString = $Mb.ProhibitSendReceiveQuota.ToString()
            
            if ($QuotaString -match "([\d\.]+)\s*GB") {
                $QuotaLimitGB = [math]::Round([double]$Matches[1], 2)
                $QuotaLimitMB = [math]::Round($QuotaLimitGB * 1024, 2)
            }
            elseif ($QuotaString -match "([\d\.]+)\s*MB") {
                $QuotaLimitMB = [math]::Round([double]$Matches[1], 2)
                $QuotaLimitGB = [math]::Round($QuotaLimitMB / 1024, 2)
            }
            elseif ($QuotaString -match "([\d\.]+)\s*bytes") {
                $bytes = [double]$Matches[1]
                $QuotaLimitGB = [math]::Round($bytes / 1GB, 2)
                $QuotaLimitMB = [math]::Round($bytes / 1MB, 2)
            }
            
            # Расчет свободного места и процентов
            if ($UsedSizeGB -and $QuotaLimitGB -ne "Безлимит") {
                $FreeSpaceGB = [math]::Round(($QuotaLimitGB - $UsedSizeGB), 2)
                $FreeSpaceMB = [math]::Round(($QuotaLimitMB - $UsedSizeMB), 2)
                if ($FreeSpaceGB -lt 0) { 
                    $FreeSpaceGB = 0 
                    $FreeSpaceMB = 0
                }
                $PercentUsed = [math]::Round(($UsedSizeGB / $QuotaLimitGB) * 100, 2)
            }
        }
        
        # Формируем запись (используем русские названия для удобства)
        $Result = [PSCustomObject]@{
            "Имя пользователя"      = $Mb.DisplayName
            "Логин (UPN)"           = $Mb.UserPrincipalName
            "Email адрес"           = $Mb.PrimarySmtpAddress
            "Тип ящика"             = $Mb.RecipientTypeDetails
            "Занято (ГБ)"           = $UsedSizeGB
            "Занято (МБ)"           = $UsedSizeMB
            "Квота (ГБ)"            = $QuotaLimitGB
            "Квота (МБ)"            = $QuotaLimitMB
            "Свободно (ГБ)"         = $FreeSpaceGB
            "Свободно (МБ)"         = $FreeSpaceMB
            "Использовано %"        = $PercentUsed
            "Порог предупреждения"  = if ($Mb.IssueWarningQuota.IsUnlimited) { "Безлимит" } else { $Mb.IssueWarningQuota.ToString() }
            "База данных"           = $Mb.Database.ToString()
        }
        
        $Results += $Result
        
        # Каждые 100 ящиков показываем промежуточный статус
        if ($Current % 100 -eq 0) {
            Write-Host "  Обработано $Current из $TotalCount ящиков..." -ForegroundColor Gray
        }
    }
    
    Write-Progress -Activity "Обработка почтовых ящиков" -Completed
    Write-Host ""
    Write-Host "Обработка завершена. Ошибок получения статистики: $ErrorCount" -ForegroundColor $(if ($ErrorCount -gt 0) { "Yellow" } else { "Green" })
    
    # 6. СОХРАНЯЕМ ОТЧЕТЫ
    Write-Host ""
    Write-Host "Сохранение отчета..." -ForegroundColor Yellow
    
    # Основной CSV файл (с разделителем ; для Excel)
    $Results | Export-Csv -Path $LocalOutputPath -NoTypeInformation -Encoding UTF8 -Delimiter ";"
    
    # Создаем краткую сводку
    $ValidResults = $Results | Where-Object { $_."Занято (ГБ)" -is [double] }
    $MailboxesWithQuota = ($Results | Where-Object { $_."Квота (ГБ)" -ne "Безлимит" }).Count
    $TotalUsedSpaceGB = [math]::Round(($ValidResults | Measure-Object -Property "Занято (ГБ)" -Sum).Sum, 2)
    $OverQuota = ($Results | Where-Object { $_."Использовано %" -ne "N/A" -and [double]$_."Использовано %" -gt 100 }).Count
    $WarningLevel = ($Results | Where-Object { $_."Использовано %" -ne "N/A" -and [double]$_."Использовано %" -ge 90 -and [double]$_."Использовано %" -le 100 }).Count
    
    $Summary = @"
=====================================================
       СВОДНЫЙ ОТЧЕТ ПО ПОЧТОВЫМ ЯЩИКАМ
=====================================================
Сервер Exchange: $ExchangeServer
Дата формирования: $(Get-Date -Format 'dd.MM.yyyy HH:mm:ss')

-------------------- СТАТИСТИКА --------------------
Всего почтовых ящиков:              $TotalCount
Ящиков с ограниченной квотой:       $MailboxesWithQuota
Ящиков без ограничения квоты:       ($TotalCount - $MailboxesWithQuota)
Общее занятое место (все ящики):    $TotalUsedSpaceGB ГБ
Ошибок получения статистики:        $ErrorCount

-------------------- ТРЕВОГИ --------------------
Ящиков, превысивших квоту (>100%):  $OverQuota
Ящиков на грани квоты (90-100%):    $WarningLevel

-------------------- ФАЙЛЫ --------------------
Детальный отчет: $LocalOutputPath
=====================================================
"@
    
    $Summary | Out-File -FilePath $LocalSummaryPath -Encoding UTF8
    
    # 7. ВЫВОД РЕЗУЛЬТАТОВ
    Write-Host ""
    Write-Host "=====================================================" -ForegroundColor Green
    Write-Host "                    ГОТОВО!" -ForegroundColor Green
    Write-Host "=====================================================" -ForegroundColor Cyan
    Write-Host ""
    Write-Host "Детальный отчет:" -ForegroundColor White
    Write-Host "  $LocalOutputPath" -ForegroundColor Yellow
    Write-Host ""
    Write-Host "Краткая сводка:" -ForegroundColor White
    Write-Host "  $LocalSummaryPath" -ForegroundColor Yellow
    Write-Host ""
    Write-Host "Статистика:" -ForegroundColor White
    Write-Host "  Всего ящиков: $TotalCount" -ForegroundColor Gray
    Write-Host "  Общий объем: $TotalUsedSpaceGB ГБ" -ForegroundColor Gray
    Write-Host "  Превысили квоту: $OverQuota" -ForegroundColor $(if ($OverQuota -gt 0) { "Red" } else { "Gray" })
    Write-Host "  На грани квоты (90-100%): $WarningLevel" -ForegroundColor $(if ($WarningLevel -gt 0) { "Yellow" } else { "Gray" })
    Write-Host ""
    Write-Host "=====================================================" -ForegroundColor Cyan
    
    # Показываем ТОП-10 самых больших ящиков
    Write-Host ""
    Write-Host "ТОП-10 САМЫХ БОЛЬШИХ ПОЧТОВЫХ ЯЩИКОВ:" -ForegroundColor White
    $TopMailboxes = $ValidResults | Sort-Object "Занято (ГБ)" -Descending | Select-Object -First 10
    $TopMailboxes | Format-Table "Имя пользователя", @{Name="Занято (ГБ)";Expression={$_. "Занято (ГБ)"}}, "Квота (ГБ)", "Использовано %" -AutoSize
    
    # Показываем ящики, превысившие квоту
    if ($OverQuota -gt 0) {
        Write-Host ""
        Write-Host "ВНИМАНИЕ! ЯЩИКИ, ПРЕВЫСИВШИЕ КВОТУ (>100%):" -ForegroundColor Red
        $OverQuotaMailboxes = $Results | Where-Object { $_."Использовано %" -ne "N/A" -and [double]$_."Использовано %" -gt 100 } | Sort-Object "Использовано %" -Descending
        $OverQuotaMailboxes | Select-Object -First 20 | Format-Table "Имя пользователя", "Занято (ГБ)", "Квота (ГБ)", "Использовано %" -AutoSize
    }
}
catch {
    Write-Host ""
    Write-Host "ОШИБКА ПРИ СБОРЕ ДАННЫХ:" -ForegroundColor Red
    Write-Host $_.Exception.Message -ForegroundColor Red
    Write-Host ""
    Write-Host "Детали ошибки:" -ForegroundColor Yellow
    Write-Host $_.Exception.ToString() -ForegroundColor Gray
}

# 8. ЗАВЕРШАЕМ СЕССИЮ
Write-Host ""
Write-Host "Завершение удаленной сессии..." -ForegroundColor Yellow

if ($Session -ne $null) {
    Remove-PSSession $Session
    Write-Host "Сессия успешно закрыта." -ForegroundColor Green
}

Write-Host ""
Write-Host "Нажмите Enter для закрытия окна..." -ForegroundColor Gray
Read-Host
