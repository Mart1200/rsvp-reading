-- The CREATE must be rolled back because the second statement fails
CREATE TABLE fixture_c (id integer);
SELECT * FROM table_that_does_not_exist;
