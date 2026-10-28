# FundSyc
Research Proposal and Consortium Management Platform

## Local example database

Install PostgreSQL and make sure its server is running. Create an empty local database called `fundsyc` (for example, with `createdb fundsyc`). From the project folder, run the schema once:

```sh
psql -d fundsyc -v ON_ERROR_STOP=1 -f db/schema.sql
```

Then add the example data:

```sh
psql -d fundsyc -v ON_ERROR_STOP=1 -f db/seed.sql
```

The seed can be run again without duplicating its example records. It does not reset changes to existing records. These commands use your local PostgreSQL connection defaults; if your setup needs a username or port, pass the appropriate `psql` options. The frontend reads from this database through a local API.


## Reset local example data

This permanently deletes everything in the local `fundsyc` database and restores the original example data. Use it only when you no longer need the data currently in that database.

```sh
dropdb -h 127.0.0.1 fundsyc
createdb -h 127.0.0.1 fundsyc
psql -h 127.0.0.1 -d fundsyc -v ON_ERROR_STOP=1 -f db/schema.sql
psql -h 127.0.0.1 -d fundsyc -v ON_ERROR_STOP=1 -f db/seed.sql
```

Refresh the app after the commands finish. If your PostgreSQL setup uses a different port or username, include the corresponding connection options.


## Run the app

After setting up the database, run `npm install` and then `npm run dev`. Open the local address printed by Vite. The API uses the local `fundsyc` database by default; set `DATABASE_URL` before starting the app if your connection needs a different address or credentials.

The API is for local development and has no authentication yet.

## Copyright & Usage

Copyright © 2026 Evangelos Kostakis. All rights reserved.

FundSyc is publicly available for viewing and educational reference purposes.

The source code is proprietary. No permission is granted to copy, modify, redistribute, sublicense, or commercially exploit this software without prior written permission from the copyright holder.

For licensing inquiries, please contact the repository owner.
