const url = 'https://bvdwxgfixirisqaavskj.supabase.co/storage/v1/bucket';
const key = 'sb_publishable_8n4-tEnAx5J98ZMh_QwZiw_Qcncleqx';

async function run() {
  try {
    const res = await fetch(url, {
      headers: {
        'apikey': key,
        'Authorization': `Bearer ${key}`
      }
    });
    console.log('Buckets response status:', res.status);
    if (res.ok) {
      console.log('Buckets:', await res.json());
    } else {
      console.log('Error:', await res.text());
    }
  } catch (err) {
    console.error(err);
  }
}

run();
