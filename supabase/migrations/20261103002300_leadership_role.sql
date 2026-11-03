-- Chairman / Managing Director: read access to the whole business (both functions), no data entry.
alter type app.role_code add value if not exists 'leadership';
