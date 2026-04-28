use anyhow::Result;
use chrono::{Datelike, Local};
use rusqlite::{Connection, OptionalExtension, params};
use std::sync::Mutex;

#[derive(Debug)]
pub struct Storage {
    conn: Mutex<Connection>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct SignInResult {
    pub count: i64,
    pub already_signed: bool,
}

impl Storage {
    pub fn open(path: &str) -> Result<Self> {
        std::fs::create_dir_all(
            std::path::Path::new(path)
                .parent()
                .unwrap_or_else(|| std::path::Path::new(".")),
        )?;
        Self::from_connection(Connection::open(path)?)
    }

    #[cfg(test)]
    pub fn open_in_memory() -> Result<Self> {
        Self::from_connection(Connection::open_in_memory()?)
    }

    fn from_connection(conn: Connection) -> Result<Self> {
        conn.execute_batch(
            "
            create table if not exists sign_in (
                uid integer primary key,
                last_day text not null,
                count integer not null
            );
            create table if not exists danmu_count (
                uid integer primary key,
                uname text not null,
                count integer not null default 0
            );
            create table if not exists blind_box_stat (
                id integer primary key autoincrement,
                uid integer not null,
                uname text not null,
                gift_name text not null,
                count integer not null,
                profit_loss integer not null,
                created_at text not null
            );
            ",
        )?;
        Ok(Self {
            conn: Mutex::new(conn),
        })
    }

    pub fn sign_in(&self, uid: i64) -> Result<SignInResult> {
        let today = today_key();
        let conn = self.conn.lock().expect("storage mutex poisoned");
        let existing: Option<(String, i64)> = conn
            .query_row(
                "select last_day, count from sign_in where uid = ?1",
                params![uid],
                |row| Ok((row.get(0)?, row.get(1)?)),
            )
            .optional()?;

        match existing {
            Some((last_day, count)) if last_day == today => Ok(SignInResult {
                count,
                already_signed: true,
            }),
            Some((_last_day, count)) => {
                let next = count + 1;
                conn.execute(
                    "update sign_in set last_day = ?2, count = ?3 where uid = ?1",
                    params![uid, today, next],
                )?;
                Ok(SignInResult {
                    count: next,
                    already_signed: false,
                })
            }
            None => {
                conn.execute(
                    "insert into sign_in (uid, last_day, count) values (?1, ?2, 1)",
                    params![uid, today],
                )?;
                Ok(SignInResult {
                    count: 1,
                    already_signed: false,
                })
            }
        }
    }

    pub fn increment_danmu_count(&self, uid: i64, uname: &str) -> Result<i64> {
        let conn = self.conn.lock().expect("storage mutex poisoned");
        conn.execute(
            "
            insert into danmu_count (uid, uname, count) values (?1, ?2, 1)
            on conflict(uid) do update set uname = excluded.uname, count = count + 1
            ",
            params![uid, uname],
        )?;
        Ok(conn.query_row(
            "select count from danmu_count where uid = ?1",
            params![uid],
            |row| row.get(0),
        )?)
    }

    pub fn danmu_count(&self, uid: i64) -> Result<i64> {
        let conn = self.conn.lock().expect("storage mutex poisoned");
        Ok(conn
            .query_row(
                "select count from danmu_count where uid = ?1",
                params![uid],
                |row| row.get(0),
            )
            .optional()?
            .unwrap_or(0))
    }

    pub fn record_blind_box_stat(
        &self,
        uid: i64,
        uname: &str,
        gift_name: &str,
        count: i64,
        profit_loss: i64,
    ) -> Result<()> {
        let conn = self.conn.lock().expect("storage mutex poisoned");
        conn.execute(
            "
            insert into blind_box_stat
                (uid, uname, gift_name, count, profit_loss, created_at)
            values (?1, ?2, ?3, ?4, ?5, ?6)
            ",
            params![
                uid,
                uname,
                gift_name,
                count,
                profit_loss,
                Local::now().to_rfc3339()
            ],
        )?;
        Ok(())
    }

    #[cfg(test)]
    pub fn blind_box_profit_loss(&self, uid: i64) -> Result<i64> {
        let conn = self.conn.lock().expect("storage mutex poisoned");
        Ok(conn.query_row(
            "select coalesce(sum(profit_loss), 0) from blind_box_stat where uid = ?1",
            params![uid],
            |row| row.get(0),
        )?)
    }
}

fn today_key() -> String {
    let now = Local::now();
    format!("{:04}-{:02}-{:02}", now.year(), now.month(), now.day())
}

#[cfg(test)]
mod tests {
    use super::Storage;

    #[test]
    fn sign_in_creates_then_reports_duplicate() {
        let storage = Storage::open_in_memory().unwrap();

        let first = storage.sign_in(10).unwrap();
        assert_eq!(first.count, 1);
        assert!(!first.already_signed);

        let second = storage.sign_in(10).unwrap();
        assert_eq!(second.count, 1);
        assert!(second.already_signed);
    }

    #[test]
    fn danmu_count_increments() {
        let storage = Storage::open_in_memory().unwrap();

        assert_eq!(storage.increment_danmu_count(10, "alice").unwrap(), 1);
        assert_eq!(storage.increment_danmu_count(10, "alice").unwrap(), 2);
        assert_eq!(storage.danmu_count(10).unwrap(), 2);
    }
}
