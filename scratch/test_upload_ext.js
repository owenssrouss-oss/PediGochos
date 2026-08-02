const url = 'https://bvdwxgfixirisqaavskj.supabase.co/storage/v1/object/menu_images/uploads/db_backup.jpg';
const key = 'sb_publishable_8n4-tEnAx5J98ZMh_QwZiw_Qcncleqx';

async function run() {
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${key}`,
        'apikey': key,
        'x-upsert': 'true',
        'Content-Type': 'image/jpeg'
      },
      body: JSON.stringify({ test: true })
    });
    console.log('Upload response status:', res.status);
    console.log('Upload response text:', await res.text());
  } catch (err) {
    console.error(err);
  }
}

run();
