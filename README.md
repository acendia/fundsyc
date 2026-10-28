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

The seed can be run again without duplicating its example records. It does not reset changes to existing records. These commands use your local PostgreSQL connection defaults; if your setup needs a username or port, pass the appropriate `psql` options. The frontend currently uses its own example data and is not connected to this database yet.


## Copyright & Usage

Copyright © 2026 Evangelos Kostakis. All rights reserved.

FundSyc is publicly available for viewing and educational reference purposes.

The source code is proprietary. No permission is granted to copy, modify, redistribute, sublicense, or commercially exploit this software without prior written permission from the copyright holder.

For licensing inquiries, please contact the repository owner.
