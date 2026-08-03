# MSCI World Dashboard

Dash-Anwendung zur Analyse eines gehebelten Amundi MSCI World ETF und eines langfristig verfügbaren iShares MSCI World ETF.

## Start

```bash
python -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
python App.py
```

Kursdaten werden standardmäßig aus `Data.xlsx` gelesen. Ein Yahoo-Abruf erfolgt ausschließlich nach Bestätigung über den Button **Kursdaten neu laden**.
