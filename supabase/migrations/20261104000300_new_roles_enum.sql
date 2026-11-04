-- D-61 / D-62: Executive Assistant and Product Head roles.
alter type app.role_code add value if not exists 'ea';
alter type app.role_code add value if not exists 'product_head';
