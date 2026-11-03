-- D-56: Business Intelligence & Growth is its own team (reporting line function 'bi'), separate from Operations and Collections.
alter type app.fn add value if not exists 'bi';
