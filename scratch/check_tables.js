const url = 'https://bvdwxgfixirisqaavskj.supabase.co';
const key = 'sb_publishable_8n4-tEnAx5J98ZMh_QwZiw_Qcncleqx';

async function run() {
  try {
    const res = await fetch(`${url}/rest/v1/establishments`, {
      headers: {
        'apikey': key,
        'Authorization': `Bearer ${key}`
      }
    });
    console.log('establishments table status:', res.status);
    if (res.ok) {
      console.log('establishments data:', await res.json());
    } else {
      console.log('No establishments table found or error:', await res.text());
    }
  } catch (err) {
    console.error(err);
  }
}

run();
