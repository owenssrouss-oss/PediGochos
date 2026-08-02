const url = 'https://bvdwxgfixirisqaavskj.supabase.co/storage/v1/object/public/menu_images/uploads/db_backup.jpg'; // test jpeg
const urlJson = 'https://bvdwxgfixirisqaavskj.supabase.co/storage/v1/object/public/menu_images/uploads/db_backup.json';

async function run() {
  try {
    const res = await fetch(urlJson);
    console.log('JSON Backup Status:', res.status);
    if (res.ok) {
      const data = await res.json();
      console.log('JSON Backup content length:', JSON.stringify(data).length);
      console.log('JSON Backup establishments:', data.establishments.map(e => ({ id: e.id, name: e.name })));
    } else {
      console.log('No JSON backup file found or error:', await res.text());
    }
  } catch (err) {
    console.error(err);
  }
}

run();
