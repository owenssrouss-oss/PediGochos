const { createClient } = require('@supabase/supabase-js');

const url = 'https://bvdwxgfixirisqaavskj.supabase.co';
const key = 'sb_publishable_8n4-tEnAx5J98ZMh_QwZiw_Qcncleqx';

const supabase = createClient(url, key);

async function run() {
  try {
    console.log('Attempting anonymous file upload using SDK...');
    const buffer = Buffer.from('hello world');
    const { data, error } = await supabase.storage
      .from('menu_images')
      .upload('uploads/test_anon.txt', buffer, {
        contentType: 'text/plain',
        upsert: true
      });
      
    if (error) {
      console.error('Anonymous upload failed:', error.message);
    } else {
      console.log('🎉 Anonymous upload successful!', data);
    }
  } catch (err) {
    console.error(err);
  }
}

run();
