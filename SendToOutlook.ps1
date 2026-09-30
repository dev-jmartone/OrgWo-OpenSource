param (
    [Parameter(Mandatory = $true)]
    [string]$Uri
)

try {
    # Remover el prefijo del protocolo para obtener solo el payload
    $base64 = $Uri -replace "(?i)^templategen://", ""
    $base64 = $base64 -replace "/$", ""
    
    # Decodificar caracteres de URL (por si el navegador añade %20, etc.)
    $base64 = [uri]::UnescapeDataString($base64)
    
    # Decodificar desde Base64
    $bytes = [System.Convert]::FromBase64String($base64)
    $json = [System.Text.Encoding]::UTF8.GetString($bytes)
    
    # Convertir JSON a Objeto
    $obj = $json | ConvertFrom-Json
    
    if ($obj.Action -eq "SaveToDb") {
        $dbPath = "$PSScriptRoot\db.json"
        
        $dbContent = "{}"
        if (Test-Path $dbPath) {
            $dbContent = Get-Content $dbPath -Raw
        }
        if ([string]::IsNullOrWhiteSpace($dbContent)) {
            $dbContent = '{"empresas":[], "tipos":[], "modelos":[], "marcas":[]}'
        }
        $db = $dbContent | ConvertFrom-Json
        
        $cat = $obj.Category
        $val = $obj.Value
        
        if ($null -ne $cat -and $null -ne $val) {
            # Make sure property exists
            if (-not (Get-Member -InputObject $db -Name $cat -MemberType Properties -ErrorAction SilentlyContinue)) {
                $db | Add-Member -MemberType NoteProperty -Name $cat -Value @()
            }
            
            $arr = @($db.$cat)
            if ($arr -notcontains $val) {
                $arr += $val
                $db.$cat = $arr | Sort-Object
                
                # Format JSON with indent
                $newJsonUncompressed = $db | ConvertTo-Json -Depth 10
                
                $utf8NoBom = New-Object System.Text.UTF8Encoding($False)
                [System.IO.File]::WriteAllText($dbPath, $newJsonUncompressed, $utf8NoBom)
            }
        }
        exit 0
    }
    
    # Crear la ruta para un borrador temporal en la carpeta %TEMP% de Windows
    $tempFileName = "BorradorTemplate_" + (Get-Date -Format "yyyyMMdd_HHmmss_ffff") + ".eml"
    $tempPath = Join-Path $env:TEMP $tempFileName
    
    # Estructura del archivo EML (Borrador no enviado)
    $emlContent = "To: $($obj.To)`r`n"
    $emlContent += "Cc: $($obj.Cc)`r`n"
    $emlContent += "Subject: $($obj.Subject)`r`n"
    $emlContent += "X-Unsent: 1`r`n"
    $emlContent += "Content-Type: text/html; charset=utf-8`r`n`r`n"
    $emlContent += "<html><head><meta charset='UTF-8'></head><body style='font-family: Arial, sans-serif;'>`r`n"
    $emlContent += $($obj.Body)
    $emlContent += "`r`n</body></html>"
    
    # Escribimos el archivo temporal en UTF-8 (sin firma BOM) para asegurar tildes y formato
    $utf8NoBom = New-Object System.Text.UTF8Encoding($False)
    [System.IO.File]::WriteAllText($tempPath, $emlContent, $utf8NoBom)
    
    # Al ejecutar Start-Process sobre un .eml, Windows invocará el cliente principal 
    # asociado a ese formato (usualmente el Nuevo Outlook), dejándolo listo como borrador.
    Start-Process $tempPath
}
catch {
    # En caso de error, guardar para depurar
    $ErrorMessage = "[$((Get-Date).ToString())] ERROR: " + $_.Exception.Message
    $ErrorMessage | Out-File "$PSScriptRoot\error_log.txt" -Append
}
