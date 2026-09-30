# lookup_outlook_user.ps1
# Resuelve un nombre contra el GAL de Outlook y devuelve el mail SMTP.
# Uso:  powershell -ExecutionPolicy Bypass -File lookup_outlook_user.ps1 -Name "Apellido, Nombre"
# Stdout: email primario (vacío si no se encontró).
# Exit code: 0 si éxito (con o sin match), 1 si error / Outlook no disponible.

param(
    [Parameter(Mandatory = $true)]
    [string]$Name
)

$ErrorActionPreference = 'Stop'

function Resolve-GalRecipient {
    param([string]$Candidate, [object]$Session)
    if ([string]::IsNullOrWhiteSpace($Candidate)) { return $null }
    $rcp = $Session.CreateRecipient($Candidate)
    $rcp.Resolve() | Out-Null
    if ($rcp.Resolved) { return $rcp }
    return $null
}

function Get-EmailFromAddressEntry {
    param([object]$AddressEntry)
    if (-not $AddressEntry) { return $null }
    # Tipo 0 = olExchangeUserAddressEntry — Address es un EX/X500 DN
    # no usable, hay que pedir el ExchangeUser para sacar el SMTP real.
    if ($AddressEntry.AddressEntryUserType -eq 0) {
        $eu = $AddressEntry.GetExchangeUser()
        if ($eu -and $eu.PrimarySmtpAddress) { return $eu.PrimarySmtpAddress }
    }
    # Otros tipos (SMTP / contacto): Address suele ser ya el mail.
    if ($AddressEntry.Address -and $AddressEntry.Address.Contains('@')) {
        return $AddressEntry.Address
    }
    return $null
}

try {
    $outlook = New-Object -ComObject Outlook.Application
    $session = $outlook.Session

    # Cadena de candidatos a probar contra el GAL — del más estricto al
    # más laxo. El GAL típicamente indexa por FirstName LastName "limpio",
    # mientras que Remedy puede traer nombres completos (con segundos
    # nombres y compuestos) que no matchean exacto.
    $candidates = New-Object System.Collections.Generic.List[string]
    $candidates.Add($Name) | Out-Null

    # "Apellido, Nombre" → "Nombre Apellido"
    if ($Name -match '^([^,]+),\s*(.+)$') {
        $candidates.Add("$($matches[2]) $($matches[1])".Trim()) | Out-Null
    }

    # Si el nombre tiene 3+ palabras, intentamos subsets (sin tocar el
    # ya probado completo): primeras dos, y primera + última. Cubre los
    # casos "DANIEL CORDERO CARRERA" → "DANIEL CORDERO" y
    # "CYNTHIA JOHANNA VAZQUEZ VERA" → "CYNTHIA VERA".
    $words = ($Name -split '\s+' | Where-Object { $_ -ne '' })
    if ($words.Count -ge 3) {
        $candidates.Add("$($words[0]) $($words[1])") | Out-Null
        $candidates.Add("$($words[0]) $($words[-1])") | Out-Null
    }
    if ($words.Count -ge 4) {
        # primera + tercera (cuando hay segundo nombre + primer apellido)
        $candidates.Add("$($words[0]) $($words[2])") | Out-Null
    }

    foreach ($cand in $candidates) {
        $rcp = Resolve-GalRecipient -Candidate $cand -Session $session
        if ($rcp) {
            $email = Get-EmailFromAddressEntry -AddressEntry $rcp.AddressEntry
            if ($email) {
                Write-Output $email
                exit 0
            }
        }
    }

    # Final fallback: cuando Resolve falla por ambigüedad (ej.
    # "Maximiliano Martin" matchea "Maximiliano Dario Martin" y
    # "Maximiliano Martinez"), iterar el GAL con pattern wildcard
    # FirstName*LastName. -like es case-insensitive y requiere que la
    # string TERMINE con LastName, así Martinez queda excluido.
    if ($words.Count -ge 2) {
        $firstWord = $words[0]
        $lastWord = $words[-1]
        $pattern = "$firstWord*$lastWord"
        try {
            $gal = $session.GetGlobalAddressList()
            if ($gal) {
                $entries = $gal.AddressEntries
                $count = $entries.Count
                # Cap a ~5000 para no colgar si el GAL es enorme.
                $max = [Math]::Min($count, 5000)
                for ($i = 1; $i -le $max; $i++) {
                    $entry = $entries.Item($i)
                    if ($entry.Name -like $pattern) {
                        $email = Get-EmailFromAddressEntry -AddressEntry $entry
                        if ($email) {
                            Write-Output $email
                            exit 0
                        }
                    }
                }
            }
        } catch {
            # GAL no disponible o iteración falló — sigue sin match.
        }
    }

    # Sin match — stdout vacío, exit 0 (no es error fatal).
    exit 0
}
catch {
    [Console]::Error.WriteLine("Error: $_")
    exit 1
}
