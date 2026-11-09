# database/balance_history_db.py
"""
Balance & Funds History Tracking for OpenAlgo.
Records snapshots of account balance (live trading balance, settled cash,
unsettled profit, collateral, P&L) for historical tracking, charting,
and ledger reporting.
"""

import datetime
import logging
import os
from dotenv import load_dotenv
from sqlalchemy import Column, DateTime, Float, Integer, String, Text, UniqueConstraint, func
from sqlalchemy.ext.declarative import declarative_base
from sqlalchemy.orm import scoped_session, sessionmaker

from database.engine_factory import create_db_engine

logger = logging.getLogger(__name__)

load_dotenv()
database_url = os.getenv("DATABASE_URL", "sqlite:///db/openalgo.db")
engine = create_db_engine(database_url)
db_session = scoped_session(sessionmaker(autocommit=False, autoflush=False, bind=engine))
Base = declarative_base()
Base.query = db_session.query_property()


class BalanceHistory(Base):
    """Historical ledger & balance snapshot record."""

    __tablename__ = "balance_history"
    __table_args__ = (
        UniqueConstraint("username", "broker", "date_str", name="uq_user_broker_date"),
    )

    id = Column(Integer, primary_key=True, index=True)
    username = Column(String(100), nullable=False, index=True)
    broker = Column(String(50), nullable=False)
    date_str = Column(String(10), nullable=False, index=True)  # YYYY-MM-DD
    timestamp = Column(DateTime, default=func.now(), onupdate=func.now(), nullable=False)

    trading_balance = Column(Float, default=0.0)      # Live total available to trade
    clear_balance = Column(Float, default=0.0)        # Settled cash balance
    unsettled_amount = Column(Float, default=0.0)     # Pending T+1 settlement
    collateral = Column(Float, default=0.0)           # Collateral margin
    realized_pnl = Column(Float, default=0.0)         # Realized M2M
    unrealized_pnl = Column(Float, default=0.0)       # Unrealized M2M
    utilised_margin = Column(Float, default=0.0)      # Used margin debits
    opening_balance = Column(Float, default=0.0)      # First recorded balance of the day
    snapshot_type = Column(String(30), default="LIVE")# OPEN, INTRADAY, CLOSE, LIVE


def init_balance_history_table():
    """Ensures balance_history table exists in the database."""
    try:
        Base.metadata.create_all(bind=engine)
    except Exception as e:
        logger.error(f"Error initializing balance_history table: {e}")


def record_balance_snapshot(username: str, broker: str, margin_data: dict, snapshot_type: str = "LIVE") -> bool:
    """
    Saves or updates today's balance snapshot for the user.
    Maintains opening_balance for the day while updating latest live values.
    """
    if not username or not margin_data:
        return False

    init_balance_history_table()
    today_str = datetime.date.today().strftime("%Y-%m-%d")

    try:
        # Extract numerical values safely
        t_bal = float(margin_data.get("tradingbalance") or margin_data.get("availablecash") or 0.0)
        c_bal = float(margin_data.get("clearbalance") or margin_data.get("availablecash") or 0.0)
        u_amt = float(margin_data.get("unsettledamount") or 0.0)
        collat = float(margin_data.get("collateral") or 0.0)
        r_pnl = float(margin_data.get("m2mrealized") or 0.0)
        ur_pnl = float(margin_data.get("m2munrealized") or 0.0)
        used_m = float(margin_data.get("utiliseddebits") or 0.0)

        # Do not record completely empty/zero data if broker call had an error
        if t_bal == 0.0 and c_bal == 0.0 and collat == 0.0 and r_pnl == 0.0:
            return False

        # If unsettled amount wasn't explicitly calculated, estimate from diff
        if u_amt == 0.0 and t_bal > c_bal:
            u_amt = max(0.0, round(t_bal - c_bal - collat, 2))

        record = (
            db_session.query(BalanceHistory)
            .filter_by(username=username, broker=broker, date_str=today_str)
            .first()
        )

        now = datetime.datetime.now()

        if record:
            # Update existing row for today with latest figures
            record.trading_balance = t_bal
            record.clear_balance = c_bal
            record.unsettled_amount = u_amt
            record.collateral = collat
            record.realized_pnl = r_pnl
            record.unrealized_pnl = ur_pnl
            record.utilised_margin = used_m
            record.timestamp = now
            record.snapshot_type = snapshot_type
            # Preserve opening balance if already set; otherwise initialize it
            if record.opening_balance == 0.0:
                record.opening_balance = c_bal
        else:
            # Insert first record for today (opening balance = clear balance)
            new_record = BalanceHistory(
                username=username,
                broker=broker,
                date_str=today_str,
                timestamp=now,
                trading_balance=t_bal,
                clear_balance=c_bal,
                unsettled_amount=u_amt,
                collateral=collat,
                realized_pnl=r_pnl,
                unrealized_pnl=ur_pnl,
                utilised_margin=used_m,
                opening_balance=c_bal,
                snapshot_type=snapshot_type,
            )
            db_session.add(new_record)

        db_session.commit()
        return True
    except Exception as e:
        db_session.rollback()
        logger.error(f"Error recording balance snapshot: {e}")
        return False
    finally:
        db_session.remove()


def get_balance_history(
    username: str,
    broker: str = None,
    days: int = None,
    from_date: str = None,
    to_date: str = None
) -> list[dict]:
    """Retrieves chronological balance history records with optional date filters."""
    init_balance_history_table()
    try:
        query = db_session.query(BalanceHistory).filter(BalanceHistory.username == username)
        if broker:
            query = query.filter(BalanceHistory.broker == broker)
        if from_date:
            query = query.filter(BalanceHistory.date_str >= from_date)
        if to_date:
            query = query.filter(BalanceHistory.date_str <= to_date)

        query = query.order_by(BalanceHistory.date_str.asc())
        if days and not (from_date or to_date):
            records = query.limit(days).all()
        else:
            records = query.all()

        history = []
        for r in records:
            history.append({
                "id": r.id,
                "date": r.date_str,
                "timestamp": r.timestamp.isoformat() if r.timestamp else "",
                "trading_balance": round(r.trading_balance or 0.0, 2),
                "clear_balance": round(r.clear_balance or 0.0, 2),
                "unsettled_amount": round(r.unsettled_amount or 0.0, 2),
                "collateral": round(r.collateral or 0.0, 2),
                "realized_pnl": round(r.realized_pnl or 0.0, 2),
                "unrealized_pnl": round(r.unrealized_pnl or 0.0, 2),
                "utilised_margin": round(r.utilised_margin or 0.0, 2),
                "opening_balance": round(r.opening_balance or 0.0, 2),
                "net_change": round((r.trading_balance or 0.0) - (r.opening_balance or 0.0), 2),
                "snapshot_type": r.snapshot_type,
            })
        return history
    except Exception as e:
        logger.error(f"Error fetching balance history: {e}")
        return []
    finally:
        db_session.remove()
