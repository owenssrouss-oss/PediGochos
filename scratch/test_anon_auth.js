const { createClient } = require('@supabase/supabase-js');

const url = 'https://bvdwxgfixirisqaavskj.supabase.co';
const key = 'sb_publishable_8n4-tEnAx5J98ZMh_QwZiw_Qcncleqx';

const supabase = createClient(url, key);

async function run() {
  try {
    console.log('Attempting anonymous sign in...');
    const { data: authData, error: authError } = await supabase.auth.signInAnonymously();
    if (authError) {
      console.error('Anonymous auth failed:', authError.message);
      return;
    }
    console.log('Anonymous sign in successful! Session role:', authData.session.user.role);
    
    // Test uploading file now
    const blob = Buffer.from(JSON.stringify({ test: true }));
    const { data: uploadData, error: uploadError } = await supabase.storage
      .from('menu_images')
      .upload('uploads/test_anon_backup.json', blob, {
        contentType: 'application/json',
        upsert: true
      });
      
    if (uploadError) {
      console.error('Upload failed even with anon auth:', uploadError.message);
    } else {
      console.log('🎉 Upload successful using Anonymous Auth!', uploadData);
    }
  } catch (err) {
    console.error(err);
  }
}

run();
