from __future__ import annotations

import json
from datetime import datetime, timezone
from pathlib import Path

import pandas as pd
import yfinance as yf


ROOT = Path(__file__).resolve().parents[1]
OUTPUT = ROOT / "data" / "dashboard.json"

INSTRUMENTS = {
    "amundi_2x": {
        "name": "Amundi MSCI World (2x) Leveraged UCITS ETF Acc",
        "ticker": "LWLD.PA",
        "isin": "FR0014010HV4",
    },
    "ishares_msci_world": {
        "name": "iShares MSCI World UCITS ETF USD (Dist)",
        "ticker": "IQQW.DE",
        "isin": "IE00B0M62Q58",
    },
    "co2_allowances": {
        "name": "SparkChange Physical Carbon EUA ETC",
        "ticker": "CO2.L",
        "isin": "XS2353177293",
    },
}


def download(ticker: str, period: str, interval: str) -> list[list[float | int]]:
    frame = yf.download(
        ticker,
        period=period,
        interval=interval,
        auto_adjust=False,
        prepost=False,
        progress=False,
        threads=False,
    )
    if frame.empty:
        raise RuntimeError(f"No data returned for {ticker} ({interval})")
    if isinstance(frame.columns, pd.MultiIndex):
        frame.columns = frame.columns.get_level_values(0)
    price_column = "Adj Close" if "Adj Close" in frame.columns else "Close"
    values = frame[[price_column]].reset_index()
    values.columns = ["date", "price"]
    values["date"] = pd.to_datetime(values["date"], utc=True, errors="coerce")
    values["price"] = pd.to_numeric(values["price"], errors="coerce")
    values = values.dropna().sort_values("date").drop_duplicates("date", keep="last")
    return [
        [int(row.date.timestamp() * 1000), round(float(row.price), 6)]
        for row in values.itertuples(index=False)
    ]


def download_daily_ohlc(ticker: str) -> list[list[float | int]]:
    """Adjusted OHLC for reproducible close-signal/next-open backtests."""
    frame = yf.download(
        ticker, period="max", interval="1d", auto_adjust=False, prepost=False,
        progress=False, threads=False,
    )
    if frame.empty:
        raise RuntimeError(f"No daily OHLC data returned for {ticker}")
    if isinstance(frame.columns, pd.MultiIndex):
        frame.columns = frame.columns.get_level_values(0)
    adjusted = "Adj Close" if "Adj Close" in frame.columns else "Close"
    values = frame[["Open", "High", "Low", "Close", adjusted]].reset_index()
    values.columns = ["date", "open", "high", "low", "close", "adjusted_close"]
    values["date"] = pd.to_datetime(values["date"], utc=True, errors="coerce")
    for column in ["open", "high", "low", "close", "adjusted_close"]:
        values[column] = pd.to_numeric(values[column], errors="coerce")
    values = values.dropna().sort_values("date").drop_duplicates("date", keep="last")
    ratio = values["adjusted_close"] / values["close"]
    for column in ["open", "high", "low"]:
        values[column] *= ratio
    return [[
        int(row.date.timestamp() * 1000), round(float(row.open), 6),
        round(float(row.high), 6), round(float(row.low), 6),
        round(float(row.adjusted_close), 6),
    ] for row in values.itertuples(index=False)]


def merge_points(old: list, fresh: list) -> list:
    by_timestamp = {int(point[0]): point for point in old}
    for point in fresh:
        by_timestamp.setdefault(int(point[0]), point)
    return [by_timestamp[key] for key in sorted(by_timestamp)]


def latest_quote(ticker: str, daily: list) -> list[float | int]:
    """Return Yahoo's current quote separately from the append-only daily history."""
    try:
        price = pd.to_numeric(yf.Ticker(ticker).fast_info.get("last_price"), errors="coerce")
        if pd.notna(price) and float(price) > 0:
            return [int(datetime.now(timezone.utc).timestamp() * 1000), round(float(price), 6)]
    except Exception as exc:
        print(f"Last Price fallback for {ticker}: {exc}")
    try:
        one_minute = download(ticker, "1d", "1m")
        if one_minute:
            return one_minute[-1]
    except Exception as exc:
        print(f"1-minute Last Price fallback for {ticker}: {exc}")
    if not daily:
        raise RuntimeError(f"No Last Price available for {ticker}")
    return [int(daily[-1][0]), float(daily[-1][1])]


def main() -> None:
    previous = {}
    if OUTPUT.exists():
        previous = json.loads(OUTPUT.read_text(encoding="utf-8"))

    result = {
        "updated_at": datetime.now(timezone.utc).isoformat(),
        "instruments": {},
    }
    previous_instruments = previous.get("instruments", {})
    for key, config in INSTRUMENTS.items():
        old = previous_instruments.get(key, {})
        daily = merge_points(old.get("daily", []), download(config["ticker"], "max", "1d"))
        daily_ohlc = download_daily_ohlc(config["ticker"])
        intraday = merge_points(old.get("intraday", []), download(config["ticker"], "60d", "5m"))
        result["instruments"][key] = {
            **config,
            "daily": daily,
            "daily_ohlc": daily_ohlc,
            "intraday": intraday,
            "last_price": latest_quote(config["ticker"], daily),
        }

    OUTPUT.parent.mkdir(parents=True, exist_ok=True)
    OUTPUT.write_text(json.dumps(result, separators=(",", ":")), encoding="utf-8")
    print(f"Wrote {OUTPUT} with {len(result['instruments'])} instruments")


if __name__ == "__main__":
    main()
